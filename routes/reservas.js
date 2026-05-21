const express = require('express');
const router = express.Router();

// Importar conexión
const connection = require('../db.js');

// Importar middlewares de autenticación
const { verificarAutenticacion, verificarAdmin, verificarUsuarioAutenticado } = require('../middlewares/auth');

// 1. CREAR RESERVA (Solo usuarios autenticados) - CON VALIDACIÓN
router.post("/reserva", verificarUsuarioAutenticado, (req, res) => {
    const { RECURSOS_ID, FECHA_INICIO, FECHA_FIN } = req.body;
    const USUARIO_ID = req.session.usuario.id;

    // Validaciones básicas
    if (!RECURSOS_ID || !FECHA_INICIO || !FECHA_FIN) {
        return res.status(400).json({
            mensaje: 'Faltan datos obligatorios'
        });
    }

    const fechaInicio = new Date(FECHA_INICIO);
    const fechaFin = new Date(FECHA_FIN);

    if (fechaFin <= fechaInicio) {
        return res.status(400).json({
            mensaje: 'La hora de fin debe ser posterior a la hora de inicio'
        });
    }
    // VALIDACIÓN DE ANTICIPACIÓN SEGÚN ROL
    const ahora = new Date();
    const horasDeAnticipacion = (fechaInicio - ahora) / (1000 * 60 * 60);
    const esEstudiante = req.session.usuario.tipo === 'ESTUDIANTE';

    if (esEstudiante && horasDeAnticipacion < 24) {
        return res.status(400).json({
            mensaje: '❌ Los estudiantes deben reservar con al menos 24 horas de anticipación'
        });
    }

    // 🔴 VALIDACIÓN DE HORARIOS BLOQUEADOS (CLASES)
    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
    const diaSemana = diasSemana[fechaInicio.getDay()];
    const fechaSolo = fechaInicio.toISOString().split('T')[0];
    // Obtener horarios bloqueados
    const queryBloqueados = `
        SELECT HORA_INICIO, HORA_FIN, MATERIA 
        FROM horarios_bloqueados 
        WHERE RECURSOS_ID = ? 
            AND DIA_SEMANA = ?
            AND ? BETWEEN FECHA_INICIO AND FECHA_FIN
    `;
    connection.query(queryBloqueados, [RECURSOS_ID, diaSemana, fechaSolo], (err, bloqueados) => {
        if (err) {
            console.error("Error al verificar horarios bloqueados:", err);
            return res.status(500).json({ mensaje: "Error al validar disponibilidad" });
        }
        // Convertir horas de la reserva a formato TIME
        const horaInicioReserva = fechaInicio.toTimeString().substring(0, 8);
        const horaFinReserva = fechaFin.toTimeString().substring(0, 8);
        // Verificar solapamiento con clases
        for (const bloqueado of bloqueados) {
            const horaBloqueadoInicio = bloqueado.HORA_INICIO;
            const horaBloqueadoFin = bloqueado.HORA_FIN;
            if (
                (horaInicioReserva >= horaBloqueadoInicio && horaInicioReserva < horaBloqueadoFin) ||
                (horaFinReserva > horaBloqueadoInicio && horaFinReserva <= horaBloqueadoFin) ||
                (horaInicioReserva <= horaBloqueadoInicio && horaFinReserva >= horaBloqueadoFin)
            ) {
                return res.status(400).json({
                    mensaje: `❌ No disponible. Hay clase: ${bloqueado.MATERIA} de ${horaBloqueadoInicio.substring(0, 5)} a ${horaBloqueadoFin.substring(0, 5)}`
                });
            }
        }

        // 🔴 VALIDACIÓN DE CONFLICTOS CON OTRAS RESERVAS
        const queryReservas = `
            SELECT FECHA_INICIO, FECHA_FIN 
            FROM reservas 
            WHERE RECURSOS_ID = ? 
                AND ESTADO IN ('CONFIRMADA', 'PENDIENTE')
                AND DATE(FECHA_INICIO) = ?
                AND (
                    (FECHA_INICIO < ? AND FECHA_FIN > ?) OR
                    (FECHA_INICIO < ? AND FECHA_FIN > ?) OR
                    (FECHA_INICIO >= ? AND FECHA_FIN <= ?)
                )
        `;

        connection.query(queryReservas, [RECURSOS_ID, fechaSolo, FECHA_INICIO, FECHA_INICIO, FECHA_FIN, FECHA_FIN, FECHA_INICIO, FECHA_FIN], (err2, reservasExistentes) => {
            if (err2) {
                console.error("Error al verificar reservas existentes:", err2);
                return res.status(500).json({ mensaje: "Error al validar disponibilidad" });
            }

            if (reservasExistentes.length > 0) {
                return res.status(400).json({
                    mensaje: '❌ Ya existe una reserva en ese horario'
                });
            }

            // ✅ TODO VÁLIDO - Crear la reserva
            const nuevaReserva = {
                USUARIO_ID: USUARIO_ID,
                RECURSOS_ID: RECURSOS_ID,
                FECHA_INICIO: FECHA_INICIO,
                FECHA_FIN: FECHA_FIN,
                ESTADO: 'PENDIENTE'
            };

            const queryInsert = 'INSERT INTO reservas SET ?';

            connection.query(queryInsert, nuevaReserva, (err3, result) => {
                if (err3) {
                    console.error("Error al crear reserva:", err3);
                    return res.status(500).json({ mensaje: "Error al crear reserva" });
                }

                // Notificar a los admins
                const io = req.app.get('io');
                io.to('admins').emit('nueva_reserva', {
                    mensaje: `Nueva solicitud de reserva #${result.insertId}`,
                    reservaId: result.insertId,
                    usuario: req.session.usuario.nombre
                });

                res.json({
                    mensaje: "✅ Reserva creada exitosamente. Estado: PENDIENTE",
                    reservaId: result.insertId
                });
            });
        });
    });
});

// 2. OBTENER TODAS LAS RESERVAS (Solo admin puede ver todas, usuarios ven solo las suyas)
router.get("/reserva", verificarAutenticacion, (req, res) => {
    let query;
    let params = [];

    if (req.session.usuario.rolId === 1) {
        // Admin ve todas las reservas
        query = `
            SELECT r.*, u.NOMBRE as USUARIO_NOMBRE, rec.NOMBRE as RECURSO_NOMBRE 
            FROM reservas r 
            JOIN usuarios u ON r.USUARIO_ID = u.USUARIO_ID 
            JOIN recursos rec ON r.RECURSOS_ID = rec.RECURSOS_ID
            ORDER BY r.FECHA_INICIO DESC
        `;
    } else {
        // Usuarios normales solo ven sus reservas
        query = `
            SELECT r.*, u.NOMBRE as USUARIO_NOMBRE, rec.NOMBRE as RECURSO_NOMBRE 
            FROM reservas r 
            JOIN usuarios u ON r.USUARIO_ID = u.USUARIO_ID 
            JOIN recursos rec ON r.RECURSOS_ID = rec.RECURSOS_ID
            WHERE r.USUARIO_ID = ?
            ORDER BY r.FECHA_INICIO DESC
        `;
        params = [req.session.usuario.id];
    }

    connection.query(query, params, (err, results) => {
        if (err) {
            console.error("Error al obtener reservas:", err);
            res.status(500).send("Error al obtener reservas");
        } else {
            res.json(results);
        }
    });
});

// 3. OBTENER RESERVA POR ID (Solo el dueño de la reserva o admin)
router.get("/reserva/:id", verificarAutenticacion, (req, res) => {
    const id = req.params.id;
    const query = `
        SELECT r.*, u.NOMBRE as USUARIO_NOMBRE, rec.NOMBRE as RECURSO_NOMBRE 
        FROM reservas r 
        JOIN usuarios u ON r.USUARIO_ID = u.USUARIO_ID 
        JOIN recursos rec ON r.RECURSOS_ID = rec.RECURSOS_ID
        WHERE r.RESERVAS_ID = ?
    `;

    connection.query(query, [id], (err, results) => {
        if (err) {
            console.error("Error al obtener reserva:", err);
            res.status(500).send("Error al obtener reserva");
        } else if (results.length === 0) {
            res.status(404).send("Reserva no encontrada");
        } 
        //  Notificar al usuario dueño de la reserva
        const io = req.app.get('io');

        // Buscar el usuario dueño de la reserva
        const queryUsuario = 'SELECT USUARIO_ID FROM reservas WHERE RESERVAS_ID = ?';
        connection.query(queryUsuario, [id], (err2, rows) => {
            if (!err2 && rows.length > 0) {
                io.to(`usuario_${rows[0].USUARIO_ID}`).emit('reserva_actualizada', {
                    mensaje: `Tu reserva #${id} fue ${nuevoEstado.toLowerCase()}`,
                    reservaId: id,
                    nuevoEstado
                });
            }
        });

        res.json({
            mensaje: `Reserva ${nuevoEstado.toLowerCase()} exitosamente`,
            nuevoEstado
        });
    });
});

// 4. ACTUALIZAR RESERVA (Solo el dueño de la reserva o admin)
router.put("/reserva/:id", verificarAutenticacion, (req, res) => {
    const id = req.params.id;
    const datosActualizar = {
        USUARIO_ID: req.body.USUARIO_ID,
        RECURSOS_ID: req.body.RECURSOS_ID,
        FECHA_INICIO: req.body.FECHA_INICIO,
        FECHA_FIN: req.body.FECHA_FIN,
        ESTADO: req.body.ESTADO
    };

    const query = 'UPDATE reservas SET ? WHERE RESERVAS_ID = ?';

    connection.query(query, [datosActualizar, id], (err, result) => {
        if (err) {
            console.error("Error al actualizar reserva:", err);
            res.status(500).send("Error al actualizar reserva");
        } else if (result.affectedRows === 0) {
            res.status(404).send("Reserva no encontrada");
        } else {
            res.send("Reserva actualizada exitosamente");
        }
    });
});

// 5. ELIMINAR RESERVA (Solo el dueño de la reserva o admin)
router.delete("/reserva/:id", verificarAutenticacion, (req, res) => {
    const id = req.params.id;
    const query = 'DELETE FROM reservas WHERE RESERVAS_ID = ?';

    connection.query(query, [id], (err, result) => {
        if (err) {
            console.error("Error al eliminar reserva:", err);
            res.status(500).send("Error al eliminar reserva");
        } else if (result.affectedRows === 0) {
            res.status(404).send("Reserva no encontrada");
        } else {
            res.send("Reserva eliminada exitosamente");
        }
    });
});

// ===== RUTAS EXCLUSIVAS PARA ADMINISTRADOR =====

// IMPORTANTE: Estas rutas solo deben ser accesibles por administradores

// 6. CAMBIAR ESTADO DE RESERVA (Solo Admin)
router.put("/admin/reserva/:id/estado", verificarAdmin, (req, res) => {
    const id = req.params.id;
    const nuevoEstado = req.body.ESTADO;

    // Validar que el estado sea válido
    const estadosValidos = ['PENDIENTE', 'CONFIRMADA', 'CANCELADA'];
    if (!estadosValidos.includes(nuevoEstado)) {
        return res.status(400).json({
            mensaje: "Estado inválido. Debe ser: PENDIENTE, CONFIRMADA o CANCELADA"
        });
    }

    const query = 'UPDATE reservas SET ESTADO = ? WHERE RESERVAS_ID = ?';

    connection.query(query, [nuevoEstado, id], (err, result) => {
        if (err) {
            console.error("Error al cambiar estado de reserva:", err);
            res.status(500).send("Error al cambiar estado de reserva");
        } else if (result.affectedRows === 0) {
            res.status(404).send("Reserva no encontrada");
        } else {
            res.json({
                mensaje: `Reserva ${nuevoEstado.toLowerCase()} exitosamente`,
                nuevoEstado: nuevoEstado
            });
        }
    });
});

// 7. OBTENER RESERVAS PENDIENTES (Solo Admin) probrar en Postman
router.get("/admin/reservas/pendientes", verificarAdmin, (req, res) => {
    const query = `
        SELECT r.*, u.NOMBRE as USUARIO_NOMBRE, rec.NOMBRE as RECURSO_NOMBRE 
        FROM reservas r 
        JOIN usuarios u ON r.USUARIO_ID = u.USUARIO_ID 
        JOIN recursos rec ON r.RECURSOS_ID = rec.RECURSOS_ID
        WHERE r.ESTADO = 'PENDIENTE'
        ORDER BY r.FECHA_INICIO ASC
    `;

    connection.query(query, (err, results) => {
        if (err) {
            console.error("Error al obtener reservas pendientes:", err);
            res.status(500).send("Error al obtener reservas pendientes");
        } else {
            res.json(results);
        }
    });
});

module.exports = router;
