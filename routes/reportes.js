const express = require('express');
const router = express.Router();
const connection = require('../db.js');
const { verificarAdmin } = require('../middlewares/auth');

// 1. TOTAL DE RESERVAS POR ESPACIO
router.get("/reportes/por-espacio", verificarAdmin, (req, res) => {
    const query = `
    SELECT 
        DATE_FORMAT(FECHA_INICIO, '%Y-%m') as mes,
        DATE_FORMAT(FECHA_INICIO, '%M %Y') as mes_nombre,
        COUNT(*) as total,
        SUM(CASE WHEN ESTADO = 'CONFIRMADA' THEN 1 ELSE 0 END) as confirmadas,
        SUM(CASE WHEN ESTADO = 'PENDIENTE' THEN 1 ELSE 0 END) as pendientes,
        SUM(CASE WHEN ESTADO = 'CANCELADA' THEN 1 ELSE 0 END) as canceladas
    FROM reservas
    GROUP BY mes, mes_nombre
    ORDER BY mes ASC
`;

    connection.query(query, (err, results) => {
        if (err) {
            console.error("Error al obtener reporte por espacio:", err);
            return res.status(500).json({ mensaje: "Error al generar reporte" });
        }
        res.json(results);
    });
});

// 2. RESERVAS POR MES
router.get("/reportes/por-mes", verificarAdmin, (req, res) => {
    const query = `
        SELECT 
            DATE_FORMAT(FECHA_INICIO, '%Y-%m') AS mes,
            DATE_FORMAT(FECHA_INICIO, '%M %Y') AS mes_nombre,
            COUNT(*) AS total,
            SUM(CASE WHEN ESTADO = 'CONFIRMADA' THEN 1 ELSE 0 END) AS confirmadas,
            SUM(CASE WHEN ESTADO = 'PENDIENTE' THEN 1 ELSE 0 END) AS pendientes,
            SUM(CASE WHEN ESTADO = 'CANCELADA' THEN 1 ELSE 0 END) AS canceladas
        FROM reservas
        GROUP BY 
            DATE_FORMAT(FECHA_INICIO, '%Y-%m'),
            DATE_FORMAT(FECHA_INICIO, '%M %Y')
        ORDER BY mes ASC
    `;

    connection.query(query, (err, results) => {
        if (err) {
            console.error("Error al obtener reporte por mes:", err);
            return res.status(500).json({
                mensaje: "Error al generar reporte",
                error: err.message
            });
        }

        res.json(results);
    });
});

// 3. ESPACIOS MÁS USADOS (Top 5)
router.get("/reportes/espacios-mas-usados", verificarAdmin, (req, res) => {
    const query = `
        SELECT 
            rec.NOMBRE as espacio,
            COUNT(r.RESERVAS_ID) as total_reservas,
            SUM(CASE WHEN r.ESTADO = 'CONFIRMADA' THEN 1 ELSE 0 END) as confirmadas
        FROM recursos rec
        LEFT JOIN reservas r ON rec.RECURSOS_ID = r.RECURSOS_ID
        GROUP BY rec.RECURSOS_ID, rec.NOMBRE
        ORDER BY total_reservas DESC
        LIMIT 5
    `;

    connection.query(query, (err, results) => {
        if (err) {
            console.error("Error al obtener espacios más usados:", err);
            return res.status(500).json({ mensaje: "Error al generar reporte" });
        }
        res.json(results);
    });
});

module.exports = router;
