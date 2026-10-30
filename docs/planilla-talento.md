# Módulo Talento › Planilla

> Estado al **31/10/2026**. Reunión con Talento (RRHH): **lunes 02/11/2026**.
> Solicitante: área de Talento (María Pía Estrada, usuario `MATA`, rol `TALENTO`).

---

## 1. Contexto

Talento calcula hoy la planilla a mano en Excel:

1. Descarga las marcaciones del **huellero** (entrada y salida de cada trabajador).
2. Calcula las **tardanzas** de cada persona.
3. Descuenta las tardanzas del **pago neto** de fin de mes.

Datos que dio Talento en la conversación previa:

| Tema | Regla |
|---|---|
| Tipo de pago | Recibo por honorarios: se paga el **neto**, sin AFP/ONP |
| 1.ª quincena | **40 %** del neto, sin descuentos |
| Fin de mes | **60 %** del neto **menos tardanzas** |
| Tolerancia | Hasta el minuto **10:59** después de la hora de ingreso |
| Tardanza de 30 min | Desde el minuto 11:00 hasta el 30:59 |
| Tardanza de 1 hora | Desde el minuto 31:00 |
| Horario FICO y B2B | 8:30 am a 7:00 pm |
| Horario resto de áreas | 9:00 am a 7:30 pm |

Lo que **no** se definió (cómo se calcula el monto del descuento) se resolvió **como lo hace una empresa grande**:

```
valor del minuto = sueldo neto ÷ 30 días ÷ 8 horas ÷ 60
descuento        = minutos de tardanza × valor del minuto
```

Ejemplo con S/ 3.000: 1 hora vale S/ 12,50 y 30 minutos, S/ 6,25.

---

## 2. Lo que se hizo

### 2.1 Ubicación y acceso

- Nuevo **módulo Talento** en el menú, con **Planilla** como primer submódulo (`/talento/planilla`).
- En la matriz de Roles y Permisos: módulo `TALENTO` y submódulo `PLANILLA`, otorgados solo al rol `TALENTO`.
- En el backend, la entrada se controla **por rol** y no por la matriz. Así, un permiso marcado por error no expone sueldos.

| Acción | TALENTO | ADMIN (soporte) | Otros roles |
|---|---|---|---|
| Ver el módulo | Sí | Sí | No |
| Importar el huellero y ver asistencia | Sí | Sí | No |
| Justificar tardanzas | Sí | Sí | No |
| Ver, importar o editar **sueldos** | Sí | **No** (se ven como `••••••`) | No |
| Ver o exportar la **planilla** con montos | Sí | **No** | No |
| Cerrar o reabrir un mes | Sí | **No** | No |

### 2.2 Confidencialidad de los sueldos

- El sueldo se **cifra en el servidor** (AES-256-GCM) antes de guardarse. La BD solo ve texto como `v1.Y9Fc…`, así que un `SELECT` directo o un backup no muestran montos.
- La clave vive en la variable `PLANILLA_KEY` del servidor y **nunca viaja a la BD**.
- El Excel de sueldos se lee en memoria y se descarta: **no se guarda en disco**.
- **Bitácora** (`planilla_auditoria`) de quién vio, importó, justificó, editó, exportó, cerró o reabrió.

### 2.3 Base de datos

Todas son tablas nuevas, sin relación con las existentes (no afectan el resto del ERP). El script está en `coreWE/scripts/planilla_ddl.sql`.

| Tabla | Para qué |
|---|---|
| `planilla_personal` | Ficha: código del huellero, DNI, nombre, área, horario, activo |
| `planilla_sueldo` | Historial de sueldos cifrados **por mes de vigencia** |
| `planilla_asistencia` | Una fila por trabajador y día: entrada, salida, justificación |
| `planilla_importacion` | Registro de cada archivo subido |
| `planilla_periodo` | Meses cerrados y la **copia cifrada** de su planilla |
| `planilla_auditoria` | Bitácora de acciones |

### 2.4 Código

- Backend: `coreWE/src/modules/planilla/` (entity, repository, usecases, controller, routes, schemas, crypto, xlsx y sus tests).
- Frontend: `coreWeApp/src/views/talento/PlanillaView.vue` y `src/services/planilla.service.js`.
- **18 tests** del cálculo, más pruebas de punta a punta contra la BD.

---

## 3. Cómo funciona hoy

### 3.1 Flujo mensual

```
Inicio de mes      →  Personal: se importa el Excel de sueldos (vigentes desde ese mes)
Durante el mes     →  (si entra alguien nuevo, se vuelve a importar con el mismo mes)
Último día del mes →  Importar huellero → revisar tardanzas → justificar
Cierre             →  Planilla del mes → exportar Excel → Cerrar periodo (queda congelado)
```

### 3.2 Pestañas

**Planilla del mes** (solo Talento)
- Indicadores: trabajadores, total de la 1.ª quincena, descuento total por tardanzas y total a pagar a fin de mes.
- Por trabajador: sueldo neto, quincena (40 %), fin de mes (60 %), tardanzas, descuento y monto a pagar.
- Al hacer clic en un trabajador se ve el detalle día por día: hora de entrada, minutos computados y descuento.
- **Exportar Excel** con dos hojas: la planilla y el detalle de tardanzas.
- **Cerrar periodo** y **Reabrir**.

**Asistencia y tardanzas**
- Cada día con hora de ingreso esperada, entrada, salida y tardanza computada.
- Filtro "Solo tardanzas e incidencias" (tardanzas, días sin salida, códigos sin ficha).
- Botón **Justificar** con motivo: permiso, comisión, descanso médico, falla del huellero u otro. Un día justificado **no se descuenta**, y la justificación se puede quitar.

**Importar huellero**
- Acepta `.xlsx` o `.csv` tal como lo exporta el huellero. Reconoce las columnas por su nombre: `No.`, `ID`, `Fecha/Hora`, o `Fecha` y `Hora` por separado, en formato dd/mm/aaaa y con AM/PM.
- Por cada día, la **primera marca es la entrada** y la **última es la salida**.
- **Vista previa** antes de guardar: rango de fechas, cantidad de marcaciones, días sin salida, códigos que no están en el maestro de personal, filas ilegibles y una muestra de 30 filas.
- Reimportar el mismo día lo **reemplaza sin duplicar** y **conserva las justificaciones**.
- Historial de las últimas importaciones.

**Personal**
- Importación con plantilla descargable: `Codigo huellero | DNI | Nombre | Area | Sueldo neto`.
- El sueldo vale **desde el mes seleccionado** hasta la siguiente carga, así que los meses anteriores no cambian.
- La vista previa muestra cada fila con su horario asignado y el reparto 40/60.
- El horario se asigna por área y **se puede editar por persona**. También se puede marcar a alguien como **inactivo**.
- Solo se agrega o actualiza a quienes vienen en el archivo; nadie se borra por no estar.

### 3.3 Meses cerrados

Al cerrar un mes se guarda una **copia cifrada** de la planilla tal como quedó. Mientras esté cerrado:

| Después del cierre… | Efecto en el mes cerrado |
|---|---|
| Se importa un sueldo nuevo para el mes siguiente | Ninguno |
| Se cambia el horario o el área de alguien | Ninguno |
| Se da de baja a un trabajador | Sigue apareciendo |
| Se intenta importar huellero o sueldos, o justificar | **Rechazado** ("periodo cerrado") |

Solo **Reabrir** permite modificarlo: descarta la copia, recalcula con los datos actuales y queda en la bitácora.

### 3.4 Ejemplo de cálculo

Sueldo neto S/ 3.000, ingreso 9:00:

| Día | Entrada | Tardanza | Descuento |
|---|---|---|---|
| 1 | 9:05 | — (tolerancia) | S/ 0 |
| 2 | 9:15 | 30 min | S/ 6,25 |
| 3 | 9:45 | justificado | S/ 0 |
| 4 | 9:40 | 60 min | S/ 12,50 |

- 1.ª quincena: **S/ 1.200,00**
- Fin de mes: S/ 1.800,00 − S/ 18,75 = **S/ 1.781,25**

---

## 4. Material para la demo

Están en `Descargas\demo-planilla\` y los datos son ficticios.

| Archivo | Contenido |
|---|---|
| `personal-demo.xlsx` | 10 trabajadores de 7 áreas, sueldos de S/ 2.400 a S/ 3.800 |
| `huellero-octubre-2026-demo.xlsx` | 443 marcaciones de octubre 2026 en formato tipo ZKTeco, con un día sin salida y un código que no está en el maestro |

Orden sugerido (con el usuario de Talento): Personal → Importar huellero → Asistencia (justificar un día) → Planilla del mes → Exportar. Opcional: entrar como ADMIN para mostrar que los sueldos aparecen ocultos.

> Los datos de la demo quedan en la BD. Hay que borrarlos antes de cargar la información real.

---

## 5. Pendientes

### 5.1 Técnicos (Sistemas)

- [ ] **Agregar `PLANILLA_KEY` al `.env` del servidor de producción** y guardarla en un lugar seguro. Si se pierde, los sueldos guardados no se pueden recuperar y hay que volver a importarlos.
- [ ] Borrar los datos de la demo antes de usar el módulo con información real.
- [ ] Los archivos `.xls` antiguos no se leen; hay que guardarlos como `.xlsx`. Se puede agregar soporte según el formato real del huellero.

### 5.2 Dependen de lo que defina Talento

| Pendiente | Situación actual | Cambio esperado |
|---|---|---|
| **Pago proporcional** (ingreso o cese a mitad de mes) | Se paga el mes completo | Fechas de ingreso y cese en Personal; pago por días ÷ 30 |
| Base del descuento | Neto ÷ 30 ÷ 8 ÷ 60 | Ajustar si Talento usa otro criterio |
| Tardanzas muy largas (después de las 10:00) | Siempre se computa 1 hora | Tope por día o minutos reales |
| Faltas completas | No se descuentan | Descontar el día (sueldo ÷ 30) si corresponde |
| Salida anticipada y horas extra | No se consideran | Según la política |
| Sábados y feriados | Cuenta cualquier día con marca | Calendario laboral y feriados |
| Marcas sin salida | Se señalan para revisión | Regla para resolverlas |
| Almuerzo y marcas intermedias | Se ignoran (primera y última marca) | Controlar el almuerzo si se pide |
| Corte del periodo | Mes calendario | Otro corte (por ejemplo, del 26 al 25) |
| Otros descuentos o ingresos | Solo tardanzas | Adelantos, bonos, comisiones |
| Quién justifica | TALENTO y ADMIN | Restringir a TALENTO si se prefiere |
| Quién reabre un mes cerrado | TALENTO | Restringir o prohibir |
| Aprobación y salida | Excel exportado | Aprobación previa, formato para el banco, constancias |

---

## 6. Preguntas para Talento (02/11/2026)

### Huellero
1. ¿Nos pueden pasar un Excel real del huellero de un mes completo? ¿Qué marca y modelo es? ¿Exporta .xls, .xlsx o .csv?
2. ¿El código del huellero de cada persona es su DNI o un número interno?
3. ¿Alguien marca varias veces al día (por ejemplo, salida y regreso del almuerzo)? ¿Hay que controlar el almuerzo?
4. Cuando falta la marca de entrada o de salida, ¿cómo lo resuelven hoy?

### Tardanzas
5. ¿Cómo sacan hoy el monto que descuentan por tardanza? ¿Pueden traer la planilla de un mes ya calculada a mano para comparar resultados?
6. Si alguien llega después de las 10:00 o al mediodía, ¿sigue siendo 1 hora o se descuenta el tiempo real? ¿Hay un tope por día?
7. ¿Se toma en cuenta la salida temprana o las horas extra?
8. ¿Se trabajan sábados? ¿Los feriados se tratan de alguna forma especial?
9. ¿Hay algún límite de tardanzas al mes que traiga otra consecuencia, como un memorándum?
10. ¿Qué justificaciones aceptan? ¿Quién las aprueba y cómo se las comunican?

### Faltas y ausencias
11. ¿Las faltas completas también se descuentan? ¿Con qué valor (el día = sueldo ÷ 30)?
12. ¿Cómo manejan las vacaciones o los días libres del personal con recibo por honorarios?

### Personal y pagos
13. ¿Hay personas con horarios distintos a los de su área, o que trabajen medio tiempo o desde casa (es decir, que no marcan)?
14. Cuando alguien entra o sale a mitad de mes, ¿se le paga proporcional?
15. ¿El corte del mes es calendario (del 1 al 30/31) o tiene otra fecha (por ejemplo, del 26 al 25)?
16. ¿Las tardanzas de los últimos días del mes se descuentan ese mismo mes o al siguiente?
17. ¿Hay otros descuentos o ingresos además de las tardanzas (adelantos, bonos, comisiones)?

### Control y salida
18. ¿Quién más debe ver la planilla (Gerencia, FICO para pagar)? ¿Debe pasar por una aprobación antes de pagar?
19. ¿En qué formato necesitan el resultado: Excel para el banco, boletas o constancias por trabajador?
20. Una vez cerrado un mes, ¿quién puede reabrirlo, o no debería poder reabrirse nunca?
