# Russell — tareas y presupuesto de horas del equipo

Aplicación web para asignar y seguir las tareas del equipo de auditoría y ver
el presupuesto de horas por cliente y semana (el Excel "PRESUPUESTO DE HORAS
2026" vive dentro de la app).

## Roles

| Rol | Qué puede hacer |
|---|---|
| **Gerente** | Todo: ver y asignar tareas a cualquiera, editar el presupuesto, administrar clientes, personas (cuentas, roles, contraseñas) y la cuenta de correo. |
| **Senior** | Ve todas las tareas y el presupuesto del equipo, crea y asigna tareas, edita el presupuesto y los clientes. No administra cuentas. |
| **Junior** | Solo ve **sus** tareas (Mis tareas) y **su** presupuesto (Mi semana). Puede cambiar el estado, registrar horas invertidas y dejar avances. |

La restricción se aplica en el servidor: a un junior el API nunca le devuelve
tareas ni presupuesto de otras personas, haga lo que haga el navegador.

## Pantallas

- **Panel** (gerente/senior): tareas abiertas, vencidas, en revisión, sin asignar; carga de la semana actual por persona frente a la cargabilidad; próximas a vencer.
- **Tareas**: tablero (arrastrar entre estados) o lista, con filtros por persona, cliente, fase y prioridad. Al asignar una tarea se envía aviso por correo si hay cuenta de Google conectada.
- **Equipo**: tarjetas por persona y mapa de carga semanal (horas presupuestadas vs. cargabilidad; rojo = sobrecarga).
- **Presupuesto**: la cuadrícula del Excel (cliente × funcionario × semana) con las fases por color. Gerente y senior editan celdas; se puede agregar filas.
- **Clientes**: equipo asignado según el presupuesto, tareas abiertas y horas.
- **Personas** (solo gerente): crear personas, cambiar rol, dar acceso con una contraseña temporal (la persona debe cambiarla al entrar), desactivar cuentas.
- **Ajustes**: cambiar la propia contraseña; el gerente conecta la cuenta de Google para los avisos y puede recargar el presupuesto base.

## Primer uso

1. Despliega en Vercel con la integración de Neon (`DATABASE_URL`).
2. Abre la app: la primera vez pide crear la cuenta del **gerente** y carga el presupuesto 2026 (clientes, 7 funcionarios, 44 semanas).
3. En **Personas**, edita a cada funcionario para ponerle su correo y pulsa el icono de llave para asignarle una contraseña temporal. Compártela por un canal seguro.
4. Para los avisos por correo sigue `CONFIGURACION.md` (Google Cloud + dos variables en Vercel) y conecta la cuenta en **Ajustes**.

## Desarrollo local

```bash
npm install
npm run dev
```

Abre <http://localhost:3000>. Sin `DATABASE_URL` se usa una base Postgres
embebida (PGlite) guardada en `.pglite/`; bórrala para empezar de cero. Con
`DATABASE_URL` definida se usa Neon.

```bash
npm test
```

Levanta un servidor temporal y recorre el flujo completo del API (configuración
inicial, roles, visibilidad por rol, presupuesto, sesiones).

## Datos base

`data/presupuesto-2026.json` se genera desde el Excel con:

```bash
python scripts/presupuesto_a_json.py "PRESUPUESTO DE HORAS 2026.xlsx"
```

Las semanas van del lunes 1 de junio de 2026 al 29 de marzo de 2027. La fase
de cada celda sale del color de relleno de la hoja (leyenda al pie del Excel).
Para volver a cargar el archivo en una base ya creada: Ajustes → *Recargar
presupuesto base* (solo el gerente); no borra tareas ni cuentas.

## Estructura

| Ruta | Qué hace |
|---|---|
| `index.html`, `app.js` | Interfaz (sin frameworks). |
| `api/auth.js` | Sesión: configuración inicial, entrar, salir, cambiar contraseña. |
| `api/people.js` | Personas y roles (gerente). |
| `api/clients.js` | Clientes. |
| `api/tasks.js` | Tareas y avances; filtra por rol. |
| `api/budget.js` | Presupuesto semanal; filtra por rol. |
| `api/mail.js` | Avisos por correo con la API de Gmail. |
| `api/auth/google/*` | OAuth de Google para la cuenta remitente (gerente). |
| `api/_lib/store.js` | Acceso a Postgres (Neon o PGlite), esquema y carga del presupuesto. |
| `api/_lib/auth.js` | Contraseñas (scrypt), sesiones (cookie HttpOnly) y comprobación de rol. |
| `dev-server.js` | Servidor local que imita las funciones de Vercel. |
| `test/api.test.js` | Prueba de extremo a extremo del API. |

Seguridad: las contraseñas se guardan con scrypt y sal; la sesión es un token
aleatorio en cookie `HttpOnly` cuyo hash se guarda en la base; los tokens de
Google nunca llegan al navegador; `POST /api/mail` arma el correo en el
servidor a partir de la tarea guardada y solo escribe a la persona asignada.
