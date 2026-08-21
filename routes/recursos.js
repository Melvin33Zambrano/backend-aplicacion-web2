const express = require('express');
const router = express.Router();

// Importar conexión a la base de datos
const connection = require('../db.js');

// Importar middlewares de autenticación
const { verificarAutenticacion, verificarAdmin } = require('../middlewares/auth');

// 1. CREAR RECURSO (Solo Admin)
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../public/images/espacios'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const nombre = Date.now() + ext;
    cb(null, nombre);
  }
});
const upload = multer({ storage });

// 1. CREAR RECURSO (Solo Admin)
router.post("/recurso", verificarAdmin, upload.single('IMAGEN'), (req, res) => {
  const nuevoRecurso = {
    NOMBRE: req.body.NOMBRE,
    descripcion: req.body.descripcion,
    ESTADO: req.body.ESTADO || 'DISPONIBLE',
    IMAGEN: req.file ? req.file.filename : null
  };

  const query = 'INSERT INTO recursos SET ?';
  connection.query(query, nuevoRecurso, (err, result) => {
    if (err) {
      return res.status(500).json({ mensaje: "Error al crear recurso", error: err.message });
    }
    res.json({ mensaje: "Recurso creado exitosamente", recursoId: result.insertId });
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
        descripcion: req.body.descripcion,
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

    // 1. Verificar si tiene reservas activas (CONFIRMADA o PENDIENTE)
    const queryReservas = `
        SELECT COUNT(*) AS total 
        FROM reservas 
        WHERE RECURSOS_ID = ? AND ESTADO IN ('CONFIRMADA', 'PENDIENTE')
    `;

    connection.query(queryReservas, [id], (errReservas, resultReservas) => {
        if (errReservas) {
            console.error("Error al verificar reservas:", errReservas);
            return res.status(500).json({
                mensaje: "Error al verificar reservas asociadas",
                error: errReservas.message
            });
        }

        const totalReservas = resultReservas[0].total;
        if (totalReservas > 0) {
            return res.status(409).json({
                mensaje: `No se puede eliminar el recurso: tiene ${totalReservas} reserva(s) activa(s) asociada(s).`
            });
        }

        // 2. Verificar si tiene horarios bloqueados asociados
        const queryBloqueos = `
            SELECT COUNT(*) AS total 
            FROM HORARIOS_BLOQUEADOS 
            WHERE RECURSOS_ID = ?
        `;

        connection.query(queryBloqueos, [id], (errBloqueos, resultBloqueos) => {
            if (errBloqueos) {
                console.error("Error al verificar bloqueos:", errBloqueos);
                return res.status(500).json({
                    mensaje: "Error al verificar bloqueos asociados",
                    error: errBloqueos.message
                });
            }

            const totalBloqueos = resultBloqueos[0].total;
            if (totalBloqueos > 0) {
                return res.status(409).json({
                    mensaje: `No se puede eliminar el recurso: tiene ${totalBloqueos} horario(s) bloqueado(s) asociado(s).`
                });
            }

            // 3. Si no tiene nada asociado, eliminar
            const queryDelete = 'DELETE FROM recursos WHERE RECURSOS_ID = ?';
            connection.query(queryDelete, [id], (err, result) => {
                if (err) {
                    console.error("Error al eliminar recurso:", err);
                    return res.status(500).json({
                        mensaje: "Error al eliminar recurso",
                        error: err.message
                    });
                } else if (result.affectedRows === 0) {
                    return res.status(404).json({ mensaje: "Recurso no encontrado" });
                } else {
                    return res.json({ mensaje: "Recurso eliminado exitosamente" });
                }
            });
        });
    });
});

// 6. DISPONIBILIDAD MENSUAL (Para pintar el calendario con niveles)
router.get("/recursos/disponibilidad-mensual", (req, res) => {
    const { mes, anio } = req.query;

    if (!mes || !anio) {
        return res.status(400).json({ mensaje: "Se requieren los parámetros mes y anio" });
    }

    // 1. Total de recursos disponibles
    connection.query('SELECT COUNT(*) AS total FROM recursos WHERE ESTADO = "DISPONIBLE"', (errTotal, resultTotal) => {
        if (errTotal) {
            console.error("Error al contar recursos:", errTotal);
            return res.status(500).json({ mensaje: "Error al calcular disponibilidad" });
        }
        const totalRecursos = resultTotal[0].total;

        // 2. Recursos distintos ocupados por reservas, agrupados por día
        const queryReservas = `
            SELECT DATE(FECHA_INICIO) AS dia, COUNT(DISTINCT RECURSOS_ID) AS ocupados
            FROM reservas
            WHERE ESTADO IN ('CONFIRMADA', 'PENDIENTE')
                AND MONTH(FECHA_INICIO) = ?
                AND YEAR(FECHA_INICIO) = ?
            GROUP BY DATE(FECHA_INICIO)
        `;

        connection.query(queryReservas, [mes, anio], (errReservas, reservasPorDia) => {
            if (errReservas) {
                console.error("Error al obtener reservas del mes:", errReservas);
                return res.status(500).json({ mensaje: "Error al calcular disponibilidad" });
            }

            // 3. Horarios bloqueados (clases) vigentes
            connection.query('SELECT DIA_SEMANA, FECHA_INICIO, FECHA_FIN, RECURSOS_ID FROM HORARIOS_BLOQUEADOS', (errBloq, bloqueados) => {
                if (errBloq) {
                    console.error("Error al obtener horarios bloqueados:", errBloq);
                    return res.status(500).json({ mensaje: "Error al calcular disponibilidad" });
                }

                const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
                const diasEnMes = new Date(anio, mes, 0).getDate();
                const resultado = {};

                for (let d = 1; d <= diasEnMes; d++) {
                    const fecha = new Date(anio, mes - 1, d);
                    const fechaStr = fecha.toISOString().split('T')[0];
                    const nombreDia = diasSemana[fecha.getDay()];

                    const reservaDia = reservasPorDia.find(r => {
                        const rDia = new Date(r.dia).toISOString().split('T')[0];
                        return rDia === fechaStr;
                    });
                    const ocupadosPorReserva = reservaDia ? reservaDia.ocupados : 0;

                    const recursosBloqueados = new Set();
                    bloqueados.forEach(b => {
                        if (b.DIA_SEMANA === nombreDia) {
                            const inicio = new Date(b.FECHA_INICIO).toISOString().split('T')[0];
                            const fin = new Date(b.FECHA_FIN).toISOString().split('T')[0];
                            if (fechaStr >= inicio && fechaStr <= fin) {
                                recursosBloqueados.add(b.RECURSOS_ID);
                            }
                        }
                    });

                    const totalOcupados = Math.min(totalRecursos, ocupadosPorReserva + recursosBloqueados.size);
                    const disponibles = totalRecursos - totalOcupados;

                    let nivel;
                    if (totalOcupados === 0) nivel = 'alta';
                    else if (disponibles === 0) nivel = 'baja';
                    else nivel = 'media';

                    resultado[fechaStr] = { totalRecursos, ocupados: totalOcupados, disponibles, nivel };
                }

                res.json({ mes: parseInt(mes), anio: parseInt(anio), dias: resultado });
            });
        });
    });
});

module.exports = router;