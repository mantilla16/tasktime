# Russell Bedford — horas por cliente

Aplicación web para asignar y consultar las horas presupuestadas del equipo de
auditoría por cliente y **día**. El Excel "PRESUPUESTO DE HORAS 2026" vive dentro
de la app, con el diseño de marca de Russell Bedford.

- Los clientes se agrupan por **sede** (Barranquilla o Santa Marta); la sede se
  edita en Clientes.
- **Asignar un cliente a una persona es independiente de las horas**: la
  asignación existe por sí misma (botón "Asignar cliente" en Semana o en
  Presupuesto) y después, semana a semana, se reparten las horas por día.
  Quitar el cliente borra también las horas que tuviera con él.
- La asignación es **por día**: en cada semana se reparten las horas de un
  cliente entre lunes y domingo. Sábados, domingos y festivos de Colombia van
  resaltados en el tablero y cada semana conserva su número (semana ISO).
- La **cargabilidad es de 42 h** por semana y persona. Si alguien la supera, la
  semana queda marcada con una alerta en la vista semanal, en el tablero y en
  el mapa de carga del equipo.

## Ingreso

Se entra con la cuenta de Microsoft 365 de la firma (`@rbcol.co`), igual que
analitica-puc y con el mismo registro de aplicación en Azure: MSAL obtiene un
`id_token` en el navegador y el servidor lo verifica contra las claves del
inquilino (firma, emisor, audiencia, vigencia y `tid`) antes de abrir sesión.
No hay contraseñas.

- La **primera persona** que entra cuando no existe ningún gerente queda como
  gerente y se carga el presupuesto 2026.
- Las personas cargadas del Excel no tienen correo: el gerente lo registra en
  **Personas** para que al entrar se reconozcan con su rol. Quien entre con un
  correo que no esté registrado queda como **junior**; el gerente puede cambiarle
  el rol después.
- Configuración (en el `.env` del servidor): `MS_TENANT_ID`, `MS_CLIENT_ID` y
  `RB_DOMINIO` (también se aceptan `AUDITORIA_MS_TENANT`, `AUDITORIA_MS_CLIENTE`
  y `AUDITORIA_DOMINIO`, los nombres de analitica-puc, para copiar el mismo
  `.env`). En Azure, el registro de la aplicación debe tener como URI de
  redirección (plataforma **SPA**) la dirección exacta de la app, por ejemplo
  `https://servidor/tasktime/`.
- Sin `MS_TENANT_ID`/`MS_CLIENT_ID` (desarrollo local) la app usa correo y
  contraseña: la primera vez pide crear la cuenta de gerente.

## Roles

| Rol | Qué puede hacer |
|---|---|
| **Gerente** | Todo: ver y asignar horas a cualquiera, administrar clientes y personas (cuentas, roles, contraseñas), recargar el presupuesto base. |
| **Senior** | Ve las horas de todo el equipo y asigna horas a cualquiera. Administra clientes. No administra cuentas. |
| **Junior** | Solo ve **sus** horas (Mi semana y Mi presupuesto). No edita nada salvo su contraseña. |

La restricción se aplica en el servidor: a un junior el API nunca le devuelve
horas de otras personas, haga lo que haga el navegador.

## Pantallas

- **Semana** (gerente/senior): selector de semana, indicadores (horas asignadas, clientes con horas, personas sobre las 42 h o sin horas) y una tarjeta por persona con sus clientes, los siete días en miniatura, fase y total. Desde ahí se asigna un cliente o se reparten sus horas por día.
- **Presupuesto**: tablero por días (cliente × funcionario × día) agrupado por sede, con el número de semana y su etiqueta, las fases por color, fines de semana y festivos resaltados y un total por semana que se pone en naranja cuando la persona supera la cargabilidad. Filtros por mes, sede, persona y cliente.
- **Equipo**: tarjetas por persona y mapa de carga semanal (naranja = por encima de la cargabilidad).
- **Clientes**: equipo asignado, horas de la semana y del periodo.
- **Tableros**: un tablero agrupa personas y clientes para verlos y asignarlos
  aparte (por ejemplo, el equipo de una sede o de un grupo de encargos). El
  tablero **General** siempre muestra todo. El selector de la cabecera cambia
  el tablero activo y todas las pantallas se acotan a sus personas y clientes;
  la asignación cliente–persona y las horas son las mismas en todos.
- **Personas** (solo gerente): crear personas, cambiar rol, dar acceso con una contraseña temporal, desactivar cuentas.
- **Ajustes**: cambiar la propia contraseña; el gerente puede recargar el presupuesto base.
- **Mi semana / Mi presupuesto** (junior): sus horas por cliente, en la semana elegida y en todo el periodo.

## Despliegue en el servidor Ubuntu

Mismo esquema que los otros proyectos del servidor: Docker Compose y un runner
auto-hospedado de GitHub Actions que corre en el propio servidor. Cada push a
`main` corre las pruebas y, si pasan, el runner actualiza `/opt/tasktime` y
reconstruye los contenedores. No hacen falta secretos.

1. **Una sola vez, en el servidor**:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/mantilla16/tasktime/main/deploy/instalar_servidor.sh -o instalar_servidor.sh
   sudo bash instalar_servidor.sh https://github.com/mantilla16/tasktime.git /opt/tasktime
   ```

   Instala Docker si falta, clona el repo en `/opt/tasktime` (dueño: el usuario
   que ejecuta `sudo`, el mismo de los runners), crea `.env` con una clave de
   Postgres aleatoria y levanta los contenedores. La app queda escuchando en
   `127.0.0.1:3100` (cámbialo en `.env` con `WEB_PORT` si está ocupado).
2. **Registrar el runner del repositorio**: en GitHub, repo tasktime → Settings →
   Actions → Runners → *New self-hosted runner*, con el mismo usuario, en una
   carpeta propia (por ejemplo `~/actions-runner-tasktime`), e instalarlo como
   servicio con `sudo ./svc.sh install <usuario> && sudo ./svc.sh start`. Si el
   repositorio vive en otra ruta, define la variable `DEPLOY_PATH` en Settings →
   Secrets and variables → Actions → Variables.
3. **Publicar con HTTPS**: copia `deploy/nginx.conf.example` a
   `/etc/nginx/sites-available/tasktime`, pon tu dominio y corre `certbot --nginx`.
4. Abre la URL: la primera vez pide crear la cuenta del **gerente** y carga el
   presupuesto 2026 (24 clientes, 7 funcionarios, 44 semanas). Luego, en
   **Personas**, registra el correo de cada funcionario y asígnale una contraseña
   temporal con el icono de llave.

Los datos viven en el volumen `pgdata` y sobreviven a los despliegues. Copia de
seguridad:

```bash
docker compose exec db pg_dump -U tasktime tasktime > respaldo.sql
```

La app también puede correr en Vercel con Neon: si `DATABASE_URL` apunta a
`*.neon.tech` usa el driver de Neon automáticamente.

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
La fase de cada celda sale del color de relleno de la hoja. Como la app asigna
por día, cada celda semanal del Excel (y cualquier dato semanal que ya
existiera en la base antes de este cambio) se reparte en partes iguales entre
los días hábiles de esa semana (lunes a viernes sin festivos); el total de la
semana se conserva exacto. La migración corre sola una vez al arrancar.
Para volver a cargar el archivo en una base ya creada: Ajustes → *Recargar
presupuesto base*.

## Cómo crece el calendario

El gerente amplía el calendario desde **Ajustes → Calendario → Ampliar hasta**.
Cada semana nueva empieza en lunes, toma la etiqueta al estilo del Excel
("Del 13 al 17", del primer día hábil al sábado), el mes que contiene la
mayoría de días hábiles y 42 h de cargabilidad. `api/_lib/calendario.js`
calcula los festivos de Colombia (incluidos los que se trasladan al lunes y los
que dependen de Semana Santa) para resaltarlos en el tablero. Después, en la
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
| `api/assignments.js` | Qué clientes tiene cada persona (sin depender de las horas). |
| `api/boards.js` | Tableros: grupos de personas y clientes. |
| `api/budget.js` | Horas por cliente, persona y día; filtra por rol. |
| `api/_lib/store.js` | Acceso a Postgres (Neon o PGlite), esquema y carga del presupuesto. |
| `api/_lib/auth.js` | Contraseñas (scrypt), sesiones (cookie HttpOnly) y comprobación de rol. |
| `server.js` | Servidor HTTP (producción con `npm start`, desarrollo con `npm run dev`). |
| `Dockerfile`, `docker-compose.yml`, `deploy/` | Despliegue en el servidor Ubuntu (ver abajo). |
| `.github/workflows/` | Pruebas en cada push y despliegue automático a `main`. |
| `test/api.test.js` | Prueba de extremo a extremo del API. |
