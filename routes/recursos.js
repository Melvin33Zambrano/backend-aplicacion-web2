const express = require('express');
const router = express.Router();

// Importar conexión a la base de datos
const connection = require('../db.js');

// Importar middlewares de autenticación
const { verificarAutenticacion, verificarAdmin } = require('../middlewares/auth');

// 1. CREAR RECURSO (Solo Admin)
router.post("/recurso", verificarAdmin, (req, res) => {
    const nuevoRecurso = {
        NOMBRE: req.body.NOMBRE,
        descripcion: req.body.DESCRIPCION,
        ESTADO: req.body.ESTADO || 'DISPONIBLE'
    };

    const query = 'INSERT INTO recursos SET ?';
    
    connection.query(query, nuevoRecurso, (err, result) => {
        if (err) {
            console.error("Error al crear recurso:", err);
            res.status(500).json({
                mensaje: "Error al crear recurso",
                error: err.message
            });
        } else {
            res.json({
                mensaje: "Recurso creado exitosamente",
                recursoId: result.insertId
            });
        }
    });
});

// 2. OBTENER TODOS LOS RECURSOS (Sin autenticación - para mostrar en formulario)
router.get("/recurso", (req, res) => {
    const query = 'SELECT * FROM recursos WHERE ESTADO = "DISPONIBLE" ORDER BY NOMBRE';
    
    connection.query(query, (err, results) => {
        if (err) {
            console.error("Error al obtener recursos:", err);
            res.status(500).json({
                mensaje: "Error al obtener recursos",
                error: err.message
            });
        } else {
            res.json(results);
        }
    });
});

// 3. OBTENER RECURSO POR ID (Usuarios autenticados)
router.get("/recurso/:id", (req, res) => {
    const id = req.params.id;
    const query = 'SELECT * FROM recursos WHERE RECURSOS_ID = ?';
    
    connection.query(query, [id], (err, results) => {
        if (err) {
            console.error("Error al obtener recurso:", err);
            res.status(500).json({
                mensaje: "Error al obtener recurso",
                error: err.message
            });
        } else if (results.length === 0) {
            res.status(404).json({
                mensaje: "Recurso no encontrado"
            });
        } else {
            res.json(results[0]);
        }
    });
});

//  OBTENER DISPONIBILIDAD DE UN RECURSO (Para el calendario)
router.get("/recurso/:id/disponibilidad", (req, res) => {
    const { id } = req.params;
    const { fecha } = req.query;

    if (!fecha) {
        return res.status(400).json({ 
            mensaje: 'Se requiere el parámetro fecha (YYYY-MM-DD)' 
        });
    }


    const fechaObj = new Date(fecha + 'T00:00:00');
    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
    const diaSemana = diasSemana[fechaObj.getDay()];

    // 1. Obtener horarios bloqueados (clases programadas)
    const queryBloqueados = `
        SELECT 
            HORA_INICIO, 
            HORA_FIN, 
            MATERIA as MOTIVO,
            PROFESOR,
            NIVEL
        FROM HORARIOS_BLOQUEADOS 
        WHERE RECURSOS_ID = ? 
            AND DIA_SEMANA = ?
            AND ? BETWEEN FECHA_INICIO AND FECHA_FIN
        ORDER BY HORA_INICIO
    `;

    // 2. Obtener reservas existentes aprobadas
    const queryReservas = `
        SELECT 
            FECHA_INICIO, 
            FECHA_FIN,
            USUARIO_ID
        FROM reservas 
        WHERE RECURSOS_ID = ? 
            AND DATE(FECHA_INICIO) = ?
            AND ESTADO IN ('CONFIRMADA', 'PENDIENTE')
        ORDER BY FECHA_INICIO
    `;
    // Ejecutar ambas consultas
    connection.query(queryBloqueados, [id, diaSemana, fecha], (err1, bloqueados) => {
        if (err1) {
            console.error('Error al obtener horarios bloqueados:', err1);
            return res.status(500).json({ 
                mensaje: 'Error al consultar disponibilidad',
                error: err1.message 
            });
        }
        connection.query(queryReservas, [id, fecha], (err2, reservas) => {
            if (err2) {
                console.error('Error al obtener reservas:', err2);
                return res.status(500).json({ 
                    mensaje: 'Error al consultar disponibilidad',
                    error: err2.message 
                });
            }
            res.json({ 
                bloqueados: bloqueados || [],
                reservas: reservas || []
            });
        });
    });
});

// 4. ACTUALIZAR RECURSO (Solo Admin)
router.put("/recurso/:id", verificarAdmin, (req, res) => {
    const id = req.params.id;
    const datosActualizar = {
        NOMBRE: req.body.NOMBRE,
        descripcion: req.body.DESCRIPCION,
        ESTADO: req.body.ESTADO
    };

    const query = 'UPDATE recursos SET ? WHERE RECURSOS_ID = ?';
    
    connection.query(query, [datosActualizar, id], (err, result) => {
        if (err) {
            console.error("Error al actualizar recurso:", err);
            res.status(500).json({
                mensaje: "Error al actualizar recurso",
                error: err.message
            });
        } else if (result.affectedRows === 0) {
            res.status(404).json({
                mensaje: "Recurso no encontrado"
            });
        } else {
            res.json({
                mensaje: "Recurso actualizado exitosamente"
            });
        }
    });
});

// 5. ELIMINAR RECURSO (Solo Admin)
router.delete("/recurso/:id", verificarAdmin, (req, res) => {
    const id = req.params.id;
    const query = 'DELETE FROM recursos WHERE RECURSOS_ID = ?';
    
    connection.query(query, [id], (err, result) => {
        if (err) {
            console.error("Error al eliminar recurso:", err);
            res.status(500).json({
                mensaje: "Error al eliminar recurso",
                error: err.message
            });
        } else if (result.affectedRows === 0) {
            res.status(404).json({
                mensaje: "Recurso no encontrado"
            });
        } else {
            res.json({
                mensaje: "Recurso eliminado exitosamente"
            });
        }
    });
});

module.exports = router;