# Russell Bedford — horas por cliente

Aplicación web para asignar y consultar las horas presupuestadas del equipo de
auditoría por cliente y semana. El Excel "PRESUPUESTO DE HORAS 2026" vive dentro
de la app, con el diseño de marca de Russell Bedford.

## Roles

| Rol | Qué puede hacer |
|---|---|
| **Gerente** | Todo: ver y asignar horas a cualquiera, administrar clientes y personas (cuentas, roles, contraseñas), recargar el presupuesto base. |
| **Senior** | Ve las horas de todo el equipo y asigna horas a cualquiera. Administra clientes. No administra cuentas. |
| **Junior** | Solo ve **sus** horas (Mi semana y Mi presupuesto). No edita nada salvo su contraseña. |

La restricción se aplica en el servidor: a un junior el API nunca le devuelve
horas de otras personas, haga lo que haga el navegador.

## Pantallas

- **Semana** (gerente/senior): selector de semana, indicadores (horas asignadas, clientes con horas, personas sobre la cargabilidad o sin horas) y una tarjeta por persona con sus clientes, fase y horas. Desde ahí se asignan clientes y se editan o quitan horas.
- **Presupuesto**: la cuadrícula anual del Excel (cliente × funcionario × semana) con las fases por color; editable celda a celda.
- **Equipo**: tarjetas por persona y mapa de carga semanal (naranja = por encima de la cargabilidad).
- **Clientes**: equipo asignado, horas de la semana y del periodo.
- **Personas** (solo gerente): crear personas, cambiar rol, dar acceso con una contraseña temporal, desactivar cuentas.
- **Ajustes**: cambiar la propia contraseña; el gerente puede recargar el presupuesto base.
- **Mi semana / Mi presupuesto** (junior): sus horas por cliente, en la semana elegida y en todo el periodo.

## Primer uso

1. Despliega en Vercel con la integración de Neon (`DATABASE_URL`).
2. Abre la app: la primera vez pide crear la cuenta del **gerente** y carga el presupuesto 2026 (24 clientes, 7 funcionarios, 44 semanas).
3. En **Personas**, edita a cada funcionario para ponerle su correo y pulsa el icono de llave para asignarle una contraseña temporal. Compártela por un canal seguro; deberá cambiarla al entrar.

## Desarrollo local

```bash
npm install
npm run dev
```

Abre <http://localhost:3000>. Sin `DATABASE_URL` se usa una base Postgres
embebida (PGlite) guardada en `.pglite/`; bórrala para empezar de cero.

```bash
npm test
```

Levanta un servidor temporal y recorre el flujo completo del API (configuración
inicial, roles, visibilidad por rol, asignación de horas, sesiones).

## Datos base

`data/presupuesto-2026.json` se genera desde el Excel con:

```bash
python scripts/presupuesto_a_json.py "PRESUPUESTO DE HORAS 2026.xlsx"
```

Las semanas del Excel van del lunes 1 de junio de 2026 al 29 de marzo de 2027.
La fase de cada celda sale del color de relleno de la hoja. Para volver a cargar
el archivo en una base ya creada: Ajustes → *Recargar presupuesto base*.

## Cómo crece el calendario

El gerente amplía el calendario desde **Ajustes → Calendario → Ampliar hasta**.
Cada semana nueva empieza en lunes, toma la etiqueta al estilo del Excel
("Del 13 al 17", del primer día hábil al sábado), el mes que contiene la
mayoría de días hábiles y una cargabilidad de 44 h menos 8 h por cada festivo
de Colombia (`api/_lib/calendario.js` calcula los festivos, incluidos los que
se trasladan al lunes y los que dependen de Semana Santa). Después, en la
cuadrícula del presupuesto, el gerente puede hacer clic en el encabezado de
una semana para ajustar su etiqueta, su mes o su cargabilidad. El filtro de mes
de la cuadrícula y del mapa de carga permite ver un mes a la vez cuando el
calendario es largo.

## Marca

`assets/tokens.css` y los logos vienen de los lineamientos de diseño de Russell
Bedford: paleta oficial, tipografía Lato, logo arriba a la izquierda y franja de
marca al pie. El CSS propio de la app (`index.html`) solo define layout y toma
todos los colores de esos tokens.

## Estructura

| Ruta | Qué hace |
|---|---|
| `index.html`, `app.js`, `assets/` | Interfaz (sin frameworks) y recursos de marca. |
| `api/auth.js` | Sesión: configuración inicial, entrar, salir, cambiar contraseña. |
| `api/people.js` | Personas y roles (gerente). |
| `api/clients.js` | Clientes. |
| `api/budget.js` | Horas por cliente, persona y semana; filtra por rol. |
| `api/_lib/store.js` | Acceso a Postgres (Neon o PGlite), esquema y carga del presupuesto. |
| `api/_lib/auth.js` | Contraseñas (scrypt), sesiones (cookie HttpOnly) y comprobación de rol. |
| `dev-server.js` | Servidor local que imita las funciones de Vercel. |
| `test/api.test.js` | Prueba de extremo a extremo del API. |
