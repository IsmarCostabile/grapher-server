const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config();

const app = express();
const corsOptions = {
    origin: ['http://localhost:3000', 'https://your-production-domain.com'], // Specify allowed origins
    methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 600 // Cache preflight requests
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
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
    host: 'fanny-mendelssohn-server.up.railway.app',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    connectTimeout: 10000 // Increase the connection timeout to 10 seconds
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
        res.send("Database initialized successfully");
    } catch (err) {
        console.error("Failed to initialize database:", err.message);
        res.status(500).send(`Failed to initialize database: ${err.message}`);
    }
});

// Save Node
app.post("/api/save-node", async (req, res) => {
    const { id, title, description, images, audioFiles, documents, videoLinks, coordinates, type, parent_id, position, connections, graph_id } = req.body;
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
        position = VALUES(position);
    `;
    const values = [
        id, 
        title, 
        description, 
        JSON.stringify(images), 
        JSON.stringify(audioFiles), 
        JSON.stringify(documents), 
        JSON.stringify(videoLinks), 
        coordinates ? JSON.stringify(coordinates) : null, 
        type, 
        parent_id, 
        position ? JSON.stringify(position) : null
    ];
    try {
        await queryAsync(query, values);
        await queryAsync("DELETE FROM connections WHERE source_id = ?", [id]);
        if (connections && connections.length > 0) {
            const insertConnectionsQuery = `
                INSERT INTO connections (source_id, target_id)
                VALUES ?
            `;
            const connectionValues = connections.map(targetId => [id, targetId]);
            await queryAsync(insertConnectionsQuery, [connectionValues]);
        }
        await queryAsync(`
            INSERT INTO node_graphs (node_id, graph_id)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE graph_id = VALUES(graph_id);
        `, [id, graph_id]);
        res.send("Node, connections, and node-graph relationship saved successfully");
    } catch (err) {
        console.error("Failed to save node:", err.message);
        res.status(500).send("Failed to save node");
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
    console.error('Server error:', err.message);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});

// Start Server
const PORT = process.env.SERVER_PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));