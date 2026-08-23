const express = require('express');
const router = express.Router();
const transporter = require('../config/email');

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

    if (req.session.usuario.tipo === 'ADMINISTRADOR') {
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
    console.log("Entró a GET /reserva/:id");
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
        } else {
            res.json(results[0]);
        }
    });
});

// 4. ACTUALIZAR RESERVA (Solo el dueño de la reserva o admin)
router.put("/reserva/:id", verificarAutenticacion, (req, res) => {
    const id = req.params.id;
    const { USUARIO_ID, RECURSOS_ID, FECHA_INICIO, FECHA_FIN, ESTADO } = req.body;

    let campos = [];
    let valores = [];

    if (USUARIO_ID !== undefined) { campos.push("USUARIO_ID = ?"); valores.push(USUARIO_ID); }
    if (RECURSOS_ID !== undefined) { campos.push("RECURSOS_ID = ?"); valores.push(RECURSOS_ID); }
    if (FECHA_INICIO !== undefined) { campos.push("FECHA_INICIO = ?"); valores.push(FECHA_INICIO); }
    if (FECHA_FIN !== undefined) { campos.push("FECHA_FIN = ?"); valores.push(FECHA_FIN); }
    if (ESTADO !== undefined) { campos.push("ESTADO = ?"); valores.push(ESTADO); }

    if (campos.length === 0) {
        return res.status(400).json({ mensaje: "No hay datos para actualizar" });
    }

    valores.push(id);
    const query = `UPDATE reservas SET ${campos.join(", ")} WHERE RESERVAS_ID = ?`;

    connection.query(query, valores, (err, result) => {
        if (err) {
            console.error("Error al actualizar reserva:", err);
            return res.status(500).send("Error al actualizar reserva");
        } else if (result.affectedRows === 0) {
            return res.status(404).send("Reserva no encontrada");
        } else {
            return res.send("Reserva actualizada exitosamente");
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
            return res.status(500).send("Error al cambiar estado de reserva");
        }
        if (result.affectedRows === 0) {
            return res.status(404).send("Reserva no encontrada");
        }

        // Buscar los datos completos de la reserva para notificar (socket + correo)
        const queryDatos = `
    SELECT r.*, u.NOMBRE as USUARIO_NOMBRE, u.CORREO as USUARIO_CORREO, 
           u.TELEFONO as USUARIO_TELEFONO, rec.NOMBRE as RECURSO_NOMBRE
    FROM reservas r
    JOIN usuarios u ON r.USUARIO_ID = u.USUARIO_ID
    JOIN recursos rec ON r.RECURSOS_ID = rec.RECURSOS_ID
    WHERE r.RESERVAS_ID = ?
`;

        connection.query(queryDatos, [id], async (err2, rows) => {
            if (!err2 && rows.length > 0) {
                const reserva = rows[0];

                // Notificación en tiempo real (Socket.io)
                const io = req.app.get('io');
                io.to(`usuario_${reserva.USUARIO_ID}`).emit('reserva_actualizada', {
                    mensaje: `Tu reserva #${id} fue ${nuevoEstado.toLowerCase()}`,
                    reservaId: id,
                    nuevoEstado: nuevoEstado
                });

                // Notificación por correo (solo para CONFIRMADA o CANCELADA)
                if (nuevoEstado === 'CONFIRMADA' || nuevoEstado === 'CANCELADA') {
                    enviarCorreoEstadoReserva(reserva, nuevoEstado);
                    
                }
            }
        });

        res.json({
            mensaje: `Reserva ${nuevoEstado.toLowerCase()} exitosamente`,
            nuevoEstado: nuevoEstado
        });
    });
});

// Función auxiliar para enviar el correo de cambio de estado
function enviarCorreoEstadoReserva(reserva, nuevoEstado) {
    const esConfirmada = nuevoEstado === 'CONFIRMADA';

    const fechaInicio = new Date(reserva.FECHA_INICIO).toLocaleString('es-EC', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    const fechaFin = new Date(reserva.FECHA_FIN).toLocaleTimeString('es-EC', {
        hour: '2-digit', minute: '2-digit'
    });

    const asunto = esConfirmada
        ? '✅ Tu reserva ha sido aprobada'
        : '❌ Tu reserva ha sido rechazada';

    const colorPrincipal = esConfirmada ? '#16a34a' : '#CC0000';
    const mensajePrincipal = esConfirmada
        ? 'Tu solicitud de reserva ha sido <strong>aprobada</strong>. Ya puedes hacer uso del espacio en el horario indicado.'
        : 'Lamentablemente tu solicitud de reserva ha sido <strong>rechazada</strong>. Puedes intentar reservar en otro horario o espacio disponible.';

    transporter.sendMail({
        from: `"ULEAM Reservas" <${process.env.EMAIL_USER}>`,
        to: reserva.USUARIO_CORREO,
        subject: asunto,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
                <h2 style="color: ${colorPrincipal};">ULEAM Reservas</h2>
                <p>Hola ${reserva.USUARIO_NOMBRE},</p>
                <p>${mensajePrincipal}</p>
                <div style="background: #f9fafb; padding: 16px; border-radius: 10px; margin: 20px 0; border-left: 4px solid ${colorPrincipal};">
                    <p style="margin: 4px 0;"><strong>Espacio:</strong> ${reserva.RECURSO_NOMBRE}</p>
                    <p style="margin: 4px 0;"><strong>Fecha y hora de inicio:</strong> ${fechaInicio}</p>
                    <p style="margin: 4px 0;"><strong>Hora de fin:</strong> ${fechaFin}</p>
                    <p style="margin: 4px 0;"><strong>Reserva #:</strong> ${reserva.RESERVAS_ID}</p>
                </div>
                <p style="color: #6b7280; font-size: 13px;">
                    Si tienes dudas, contacta a reservas@uleam.edu.ec
                </p>
            </div>
        `
    }).catch(err => {
        console.error('Error al enviar correo de estado de reserva:', err);
    });
}


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
