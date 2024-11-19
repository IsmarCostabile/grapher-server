const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config();

const app = express();
const corsOptions = {
    origin: true, // Allow all origins in development
    methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'Access-Control-Allow-Origin',
        'Access-Control-Allow-Headers'
    ],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(bodyParser.json());

app.use((req, res, next) => {
    console.log('\n=== REQUEST LOG ===');
    console.log(`🚀 ${req.method} ${req.url}`);
    console.log('📋 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📦 Body:', JSON.stringify(req.body, null, 2));
    console.log('==================\n');
    next();
});

// MySQL Connection
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', // Make sure this is correct
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    connectTimeout: 10000,
    ssl: {
        rejectUnauthorized: false // Add this for Railway.app MySQL connections
    }
});

// Add a connection error handler
db.on('error', (err) => {
    console.error('Database error:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('Attempting to reconnect to database...');
        db.connect((err) => {
            if (err) {
                console.error("Reconnection failed:", err.message);
            } else {
                console.log("Reconnected to database");
            }
        });
    }
});

db.connect((err) => {
    if (err) {
        console.error("❌ Database connection failed:", err.message);
        process.exit(1);
    }
    console.log("✅ Connected to MySQL database.");
});

const queryAsync = (query, values) => {
    return new Promise((resolve, reject) => {
        db.query(query, values, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

// Initialize MySQL Database
app.post("/api/init-db", async (req, res) => {
    try {
        // Add explicit error handling for database connection
        if (!db || !db.query) {
            throw new Error("Database connection not established");
        }

        // Add response headers
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Test the connection first
        await queryAsync('SELECT 1');

        await queryAsync(`
            CREATE TABLE IF NOT EXISTS nodes (
                id VARCHAR(255) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                images TEXT,
                audioFiles TEXT,
                documents TEXT,
                videoLinks TEXT,
                coordinates VARCHAR(255),
                type VARCHAR(50) NOT NULL,
                parent_id VARCHAR(255),
                position VARCHAR(255),
                FOREIGN KEY (parent_id) REFERENCES nodes(id)
            );
        `);
        await queryAsync(`
            CREATE TABLE IF NOT EXISTS connections (
                source_id VARCHAR(255),
                target_id VARCHAR(255),
                PRIMARY KEY (source_id, target_id),
                FOREIGN KEY (source_id) REFERENCES nodes(id),
                FOREIGN KEY (target_id) REFERENCES nodes(id)
            );
        `);
        await queryAsync(`
            CREATE TABLE IF NOT EXISTS node_graphs (
                node_id VARCHAR(255),
                graph_id VARCHAR(255),
                PRIMARY KEY (node_id, graph_id),
                FOREIGN KEY (node_id) REFERENCES nodes(id)
            );
        `);
        
        res.status(200).json({ message: "Database initialized successfully" });
    } catch (err) {
        console.error("Failed to initialize database:", err.message);
        res.status(500).json({ error: `Failed to initialize database: ${err.message}` });
    }
});

// Save Node
app.post("/api/save-node", async (req, res) => {
    try {
        console.log('Received save node request:', req.body);
        
        const { 
            id, 
            title, 
            description, 
            images, 
            audioFiles, 
            documents, 
            videoLinks, 
            coordinates, 
            type, 
            parent_id, 
            position, 
            connections, 
            graph_id 
        } = req.body;

        if (!id || !title) {
            return res.status(400).json({ error: "Missing required fields (id, title)" });
        }

        // First ensure the node exists or create it
        const query = `
            INSERT INTO nodes (id, title, description, images, audioFiles, documents, videoLinks, coordinates, type, parent_id, position)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            description = VALUES(description),
            images = VALUES(images),
            audioFiles = VALUES(audioFiles),
            documents = VALUES(documents),
            videoLinks = VALUES(videoLinks),
            coordinates = VALUES(coordinates),
            type = VALUES(type),
            parent_id = VALUES(parent_id),
            position = VALUES(position)
        `;

        const values = [
            id, 
            title, 
            description || null, 
            images ? JSON.stringify(images) : '[]', 
            audioFiles ? JSON.stringify(audioFiles) : '[]', 
            documents ? JSON.stringify(documents) : '[]', 
            videoLinks ? JSON.stringify(videoLinks) : '[]', 
            coordinates ? JSON.stringify(coordinates) : null, 
            type || 'normal', 
            parent_id || null, 
            position ? JSON.stringify(position) : JSON.stringify({"dx":0,"dy":0})
        ];

        await queryAsync(query, values);

        // Handle connections if they exist
        if (connections && Array.isArray(connections)) {
            await queryAsync("DELETE FROM connections WHERE source_id = ?", [id]);
            
            if (connections.length > 0) {
                const connectionValues = connections.map(targetId => [id, targetId]);
                await queryAsync(
                    "INSERT INTO connections (source_id, target_id) VALUES ?",
                    [connectionValues]
                );
            }
        }

        // Handle graph association
        if (graph_id) {
            await queryAsync(`
                INSERT INTO node_graphs (node_id, graph_id)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE graph_id = VALUES(graph_id)
            `, [id, graph_id]);
        }

        res.status(200).json({ 
            message: "Node saved successfully",
            nodeId: id
        });
    } catch (err) {
        console.error("Failed to save node:", err);
        res.status(500).json({ 
            error: "Failed to save node", 
            details: err.message 
        });
    }
});

// Delete Node
app.delete("/api/delete-node/:id", async (req, res) => {
    const { id } = req.params;
    try {
        await queryAsync("DELETE FROM connections WHERE source_id = ? OR target_id = ?", [id, id]);
        await queryAsync("DELETE FROM node_graphs WHERE node_id = ?", [id]);
        await queryAsync("DELETE FROM nodes WHERE id = ?", [id]);
        res.send("Node deleted successfully");
    } catch (err) {
        console.error("Failed to delete node:", err.message);
        res.status(500).send("Failed to delete node");
    }
});

// Load Nodes
app.get("/api/load-nodes", async (req, res) => {
    const query = `
        SELECT nodes.*, 
               GROUP_CONCAT(DISTINCT connections.target_id) AS connections, 
               GROUP_CONCAT(DISTINCT node_graphs.graph_id) AS graphs
        FROM nodes
        LEFT JOIN connections ON nodes.id = connections.source_id
        LEFT JOIN node_graphs ON nodes.id = node_graphs.node_id
        GROUP BY nodes.id
    `;
    try {
        const results = await queryAsync(query);
        const formattedResults = results.map(row => ({
            id: row.id,
            title: row.title,
            description: row.description,
            images: row.images ? JSON.parse(row.images) : [],
            audioFiles: row.audioFiles ? JSON.parse(row.audioFiles) : [],
            documents: row.documents ? JSON.parse(row.documents) : [],
            videoLinks: row.videoLinks ? JSON.parse(row.videoLinks) : [],
            coordinates: row.coordinates ? JSON.parse(row.coordinates) : null,
            type: row.type,
            parent_id: row.parent_id,
            position: row.position ? JSON.parse(row.position) : {"dx":0,"dy":0},
            connections: row.connections ? row.connections.split(',').filter(Boolean) : [],
            graphs: row.graphs ? row.graphs.split(',').filter(Boolean) : []
        }));
        res.json(formattedResults);
    } catch (err) {
        console.error("Failed to load nodes:", err.message);
        res.status(500).send("Failed to load nodes");
    }
});

// Fetch Node by ID
app.get("/api/node/:id", async (req, res) => {
    const { id } = req.params;
    const query = `
        SELECT nodes.*, 
               GROUP_CONCAT(DISTINCT connections.target_id) AS connections, 
               GROUP_CONCAT(DISTINCT node_graphs.graph_id) AS graphs
        FROM nodes
        LEFT JOIN connections ON nodes.id = connections.source_id
        LEFT JOIN node_graphs ON nodes.id = node_graphs.node_id
        WHERE nodes.id = ?
        GROUP BY nodes.id
    `;
    try {
        const results = await queryAsync(query, [id]);
        if (results.length === 0) {
            return res.status(404).send("Node not found");
        }
        const node = results[0];
        res.json({
            ...node,
            images: JSON.parse(node.images),
            audioFiles: JSON.parse(node.audioFiles),
            documents: JSON.parse(node.documents),
            videoLinks: JSON.parse(node.videoLinks),
            connections: node.connections ? node.connections.split(',') : [],
            graphs: node.graphs ? node.graphs.split(',') : []
        });
    } catch (err) {
        console.error("Failed to fetch node:", err.message);
        res.status(500).send("Failed to fetch node");
    }
});

// Add error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error'
    });
});

// Start Server
const PORT = process.env.SERVER_PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));