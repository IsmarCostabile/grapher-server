const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
const { v4: uuidv4 } = require('uuid'); // Add this line
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
let db;

const connectToDatabase = () => {
    db = mysql.createConnection({
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

    db.connect((err) => {
        if (err) {
            console.error("❌ Database connection failed:", err.message);
            setTimeout(connectToDatabase, 2000); // Retry connection after 2 seconds
        } else {
            console.log("✅ Connected to MySQL database.");
        }
    });

    db.on('error', (err) => {
        console.error('Database error:', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            console.log('Attempting to reconnect to database...');
            connectToDatabase();
        }
    });
};

connectToDatabase();

const queryAsync = (query, values) => {
    return new Promise((resolve, reject) => {
        db.query(query, values, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

// Ensure the database connection is open before executing queries
const ensureConnection = async () => {
    if (!db || db.state === 'disconnected') {
        connectToDatabase();
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for 2 seconds to reconnect
    }
};

// Initialize MySQL Database
app.post("/api/init-db", async (req, res) => {
    try {
        await ensureConnection();

        // Add response headers
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Test the connection first
        await queryAsync('SELECT 1');

        await queryAsync(`
            CREATE TABLE IF NOT EXISTS nodes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                images TEXT,
                audioFiles TEXT,
                documents TEXT,
                videoLinks TEXT,
                coordinates VARCHAR(255),
                type VARCHAR(50) NOT NULL,
                parent_id INT,
                position VARCHAR(255),
                superNodeId INT,
                FOREIGN KEY (parent_id) REFERENCES nodes(id)
            );
        `);
        await queryAsync(`
            CREATE TABLE IF NOT EXISTS connections (
                source_id INT,
                target_id INT,
                PRIMARY KEY (source_id, target_id),
                FOREIGN KEY (source_id) REFERENCES nodes(id),
                FOREIGN KEY (target_id) REFERENCES nodes(id)
            );
        `);
        await queryAsync(`
            CREATE TABLE IF NOT EXISTS node_graphs (
                node_id INT,
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

// Drop All Tables
app.post("/api/drop-tables", async (req, res) => {
    try {
        await ensureConnection();

        // Add response headers
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Drop the tables
        await queryAsync('DROP TABLE IF EXISTS connections');
        await queryAsync('DROP TABLE IF EXISTS node_graphs');
        await queryAsync('DROP TABLE IF EXISTS nodes');

        res.status(200).json({ message: "All tables dropped successfully" });
    } catch (err) {
        console.error("Failed to drop tables:", err.message);
        res.status(500).json({ error: `Failed to drop tables: ${err.message}` });
    }
});

// Save Node
app.post("/api/save-node", async (req, res) => {
    try {
        await ensureConnection();

        console.log('Received save node request:', req.body);
        
        let { 
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
            graph_id,
            superNodeId // Add this line
        } = req.body;

        if (!title) {
            return res.status(400).json({ error: "Missing required field (title)" });
        }

        // Ensure position is correctly formatted as a JSON string
        if (typeof position === 'object') {
            position = JSON.stringify(position);
        }

        // Filter out null values from connections
        connections = connections ? connections.filter(conn => conn !== null) : [];

        // First ensure the node exists or create it
        const query = `
            INSERT INTO nodes (id, title, description, images, audioFiles, documents, videoLinks, coordinates, type, parent_id, position, superNodeId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            position = VALUES(position),
            superNodeId = VALUES(superNodeId) // Add this line
        `;

        const values = [
            id || null,
            title, 
            description || null, 
            images ? JSON.stringify(images) : '[]', 
            audioFiles ? JSON.stringify(audioFiles) : '[]', 
            documents ? JSON.stringify(documents) : '[]', 
            videoLinks ? JSON.stringify(videoLinks) : '[]', 
            coordinates ? JSON.stringify(coordinates) : null, 
            type || 'normal', 
            parent_id || null, 
            position || JSON.stringify({"dx":0,"dy":0}),
            superNodeId || null // Add this line
        ];

        const result = await queryAsync(query, values);
        if (!id) {
            id = result.insertId; // Get the auto-incremented ID
        }

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

app.get("/api/load-nodes", async (req, res) => {
    try {
        await ensureConnection();

        const query = `
            SELECT nodes.*, 
                   GROUP_CONCAT(DISTINCT connections.target_id) AS connections, 
                   GROUP_CONCAT(DISTINCT node_graphs.graph_id) AS graphs
            FROM nodes
            LEFT JOIN connections ON nodes.id = connections.source_id
            LEFT JOIN node_graphs ON nodes.id = node_graphs.node_id
            GROUP BY nodes.id
        `;
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
            graphs: row.graphs ? row.graphs.split(',').filter(Boolean) : [],
            superNodeId: row.superNodeId 
        }));
        res.json(formattedResults);
    } catch (err) {
        console.error("Failed to load nodes:", err.message);
        res.status(500).send("Failed to load nodes");
    }
});

// Delete Node
app.delete("/api/delete-node/:id", async (req, res) => {
    const { id } = req.params;
    try {
        await ensureConnection();

        if (!id) {
            return res.status(400).json({ error: "Node ID is required" });
        }

        console.log(`Deleting node with ID: ${id}`); // Log the node ID being deleted

        // Ensure the node exists before attempting to delete
        const nodeExists = await queryAsync("SELECT id FROM nodes WHERE id = ?", [id]);
        if (nodeExists.length === 0) {
            console.log(`Node with ID ${id} not found`); // Log if the node is not found
            return res.status(404).json({ error: "Node not found" });
        }

        // Delete connections and node_graphs associated with the node
        await queryAsync("DELETE FROM connections WHERE source_id = ? OR target_id = ?", [id, id]);
        await queryAsync("DELETE FROM node_graphs WHERE node_id = ?", [id]);
        const deleteNode = await queryAsync("DELETE FROM nodes WHERE id = ?", [id]);

        console.log(`Delete node result:`, deleteNode); // Log the result of the delete query

        res.setHeader('Content-Type', 'application/json');
        res.status(200).json({ message: "Node deleted successfully" });
    } catch (err) {
        console.error("Failed to delete node:", err.message);
        res.status(500).json({ error: "Failed to delete node" });
    }
});

// Load Nodes
app.get("/api/load-nodes", async (req, res) => {
    try {
        await ensureConnection();

        const query = `
            SELECT nodes.*, 
                   GROUP_CONCAT(DISTINCT connections.target_id) AS connections, 
                   GROUP_CONCAT(DISTINCT node_graphs.graph_id) AS graphs
            FROM nodes
            LEFT JOIN connections ON nodes.id = connections.source_id
            LEFT JOIN node_graphs ON nodes.id = node_graphs.node_id
            GROUP BY nodes.id
        `;
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
            graphs: row.graphs ? row.graphs.split(',').filter(Boolean) : [],
            superNodeId: row.superNodeId 
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
    try {
        await ensureConnection();

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
        const results = await queryAsync(query, [id]);
        if (results.length === 0) {
            return res.status(404).json({ error: "Node not found" });
        }
        const node = results[0];
        res.json({
            id: node.id,
            title: node.title,
            description: node.description,
            images: node.images ? JSON.parse(node.images) : [],
            audioFiles: node.audioFiles ? JSON.parse(node.audioFiles) : [],
            documents: node.documents ? JSON.parse(node.documents) : [],
            videoLinks: node.videoLinks ? JSON.parse(node.videoLinks) : [],
            coordinates: node.coordinates ? JSON.parse(node.coordinates) : null,
            type: node.type,
            parent_id: node.parent_id,
            position: node.position ? JSON.parse(node.position) : {"dx":0,"dy":0},
            connections: node.connections ? node.connections.split(',').filter(Boolean) : [],
            graphs: node.graphs ? node.graphs.split(',').filter(Boolean) : [],
            superNodeId: node.superNodeId
        });
    } catch (err) {
        console.error("Failed to fetch node:", err.message);
        res.status(500).json({ error: "Failed to fetch node" });
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