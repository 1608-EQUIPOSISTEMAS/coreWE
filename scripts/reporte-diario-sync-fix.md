# Reporte Diario — por qué el sync dejó de pegar (04/08/2026)

Sheet "Reporte Diario" (`103ct6X7chcxAq3TY3F9BIPMp8UZwNpjgrZ_ECSLL8ak`), Apps Script bound
`1TgIGoULYeE9-t7nns4cYAmQhwVGt70-rwg72vEtYfB62ZJF7adRGEgrn`, función `sincronizarFuente`.

## Síntoma

`Fuente Estatico` congelada al 31/07 y agosto en S/.0 en toda la matriz, aunque la pestaña
AGOSTO del origen ya tenía 376 ventas. En el log, cada ciclo:

```
Snapshot incompleto (2856 filas vs 3849 ya pegadas). NO se toco Fuente Estatico.
```

## Causa raíz

Dos columnas auxiliares de `Fuente Estatico` se corrieron un lugar (alguien insertó una
columna en `R`): el monto en soles pasó de `R` a **`S`** y la categoría de `S` a **`T`**.
El script nunca se enteró:

| | esperaba | realidad |
|---|---|---|
| arrastre de fórmulas | `R1:S1` → cols 18-19 | debía ser `S1:T1` → cols 19-20 |
| limpieza de la cola | `clearContent` sobre 19 cols (`A:S`) | debía cubrir 20 (`A:T`) |

Consecuencia en cadena:

1. La columna `T` (categoría) quedaba **fuera** del arrastre y **fuera** de la limpieza.
2. Un arrastre manual viejo dejó fórmulas en `T` hasta la fila **3849**, con sólo 2.490
   filas de datos reales. Esas fórmulas devuelven texto aunque la fila esté vacía.
3. `dst.getLastRow()` cuenta cualquier celda con contenido → devolvía **3849**, no 2490.
4. La guarda `snapshotIncompleto` compara `origen (2856) < copia previa (3849)` → concluye
   "bloque truncado" y **omite el ciclo**. Como nada limpiaba `T`, el estado nunca se
   corregía solo: bloqueo permanente.

La guarda no estaba mal; le estaban dando una medida inflada de la copia anterior.

## Arreglo aplicado

1. `pegar()` arrastra `S1:T1` (cols 19-20) y limpia 20 columnas en lugar de 19.
2. Nueva `recortarCola(dst)`, llamada desde `sincronizarFuente` **antes** de leer
   `filasPrevias`: borra `A:T` por debajo de la última fila con fecha real en la col `B`.
   Hace el sistema auto-curativo ante cualquier fórmula arrastrada de más.

```js
function recortarCola(dst) {
  var maxFilas = dst.getMaxRows();
  var fechas = dst.getRange(1, 2, maxFilas, 1).getValues();
  var ultima = 0;
  for (var i = fechas.length - 1; i >= 0; i--) {
    if (fechas[i][0] !== '' && fechas[i][0] !== null) { ultima = i + 1; break; }
  }
  if (!ultima || dst.getLastRow() <= ultima) return 0;
  var sobran = maxFilas - ultima;
  dst.getRange(ultima + 1, 1, sobran, 20).clearContent();
  console.log('Cola recortada: se limpiaron ' + sobran + ' filas huerfanas debajo de la ' + ultima + '.');
  return sobran;
}
```

3. Se agregó `diagnostico()` (primera función del archivo, así queda preseleccionada en el
   selector del editor): compara Fuente Principal contra Fuente Estatico, dice en qué fila
   divergen y cuenta filas por mes a cada lado. Es lo que destapó el problema: mostró
   `Fuente Estatico por mes: {"2026-06":1281,"2026-07":1209,"?":1359}` — 1.359 filas sin
   fecha, o sea la cola fantasma de la columna `T`.

## Resultado tras correr `sincronizarFuente`

```
Cola recortada: se limpiaron 1359 filas huerfanas debajo de la 2490.
Copiadas 2858 filas. Celdas con error en el origen: 13 (#REF! en la col 12)
```

INGRESOS TOTALES: Junio 324.806,52 (1078) · Julio 370.812 (1063) · **Agosto 33.004 (116)**.

## Pendiente (del origen, no del script)

13 celdas con `#REF!` en la columna 12 (`L`, medio de pago) del archivo
"Ing. Operativos - GRUPO WE | 2026". Se copian tal cual a propósito: son dato malo del
origen, no una rotura, y no afectan monto ni categoría.

---

# El import se amplió a la columna R (10/08/2026)

El origen agregó una columna `R` = **`WE PLUS-DESC`**: marca la venta hecha con descuento de
membresía Plus. Va a la fila **"6. Programas con Dcto Membresias Plus"** de `Reporte Ingresos`
(clave `ENVIVO-DCTO PLUS`).

La fórmula de `Fuente Estatico!T` (categoría) **ya** contemplaba el caso desde antes:

```
IF(E1="EN VIVO"; IF(ISNUMBER(SEARCH("WE PLUS"; R1)); "ENVIVO-DCTO PLUS"; …
```

pero `R` llegaba siempre vacía porque el pipeline cortaba en `Q`. Resultado: la fila salía en
S/.0 aunque hubiera ventas.

## Qué se cambió

| Dónde | Antes | Ahora |
|---|---|---|
| `Fuente Principal!A1` (3 `IMPORTRANGE`) | `JUNIO/JULIO/AGOSTO!A30:Q3000` | `…!A30:R3000` |
| `Código.gs` — 4 llamadas a `getRange(1, 1, …, 17)` | `17` literal repetido | constante `COLUMNAS_DATOS = 18` |

El `17` estaba copiado en cuatro funciones (`diagnostico`, `sincronizarFuente`, `pegar`,
`forzarPegado`). Ese duplicado es la misma clase de bug que congeló el sync en agosto: se
reemplazó por una sola constante para que el ancho no pueda volver a divergir.

**Techo conocido:** `S` (monto en soles) y `T` (categoría) son columnas propias de
`Fuente Estatico`. Si el origen crece más allá de `R`, hay que correr `S` y `T` **antes** de
subir `COLUMNAS_DATOS`; si no, el pegado pisa la fórmula del monto. El comentario que está
sobre la constante dice esto mismo.

## Resultado tras correr `sincronizarFuente`

```
Copiadas 3054 filas. Celdas con error en el origen: 28 (#REF! en la col 12)
```

"6. Programas con Dcto Membresias Plus": Junio **S/.100** · Julio **S/.1.100** (antes S/.0 en
todos los meses). Agosto sigue en 0: el origen todavía no marca ventas con `WE PLUS-DESC` ese mes.

## `construirConsolidado()` estaba roto por el renombre de pestañas (arreglado el 10/08/2026)

Las pestañas se renombraron —`Ingresos Diarios` → **`Reporte Ingresos`** y `Consolidado Mensual`
→ **`Reporte Consolidado`**— y el script seguía buscando los nombres viejos:

- `bloqueUnidades()` filtraba por `/ingresos\s*diarios/i` → tiraba
  `Error: No encuentro la hoja Ingresos Diarios`.
- Fallaba **después** de `insertSheet('Consolidado Mensual')`, así que cada corrida dejaba una
  pestaña vacía que había que borrar a mano.

Las fórmulas del tablero nunca dejaron de funcionar (son `SUMIFS` sobre `Fuente Estatico`), o
sea se actualizaba solo; lo que no se podía era regenerarlo.

### Qué se cambió

- Nueva `hojaIngresos(ss)`: busca por **coincidencia parcial** (`/ingresos/i`) en vez de por el
  nombre completo, para que el próximo renombre no vuelva a romperlo.
- Nueva constante `TABLERO = 'Reporte Consolidado'`, usada en el `getSheetByName` y en el
  `insertSheet` (antes el literal estaba escrito dos veces).
- **El origen se resuelve ANTES del `deleteSheet`/`insertSheet`.** Ese era el defecto real: la
  validación iba después de la parte destructiva, por eso cada fallo dejaba basura.
- `bloqueUnidades(diario, FE, MES)` recibe la hoja ya resuelta en vez de volver a buscarla.

Corrida de verificación: `Consolidado listo. Metricas en filas 7-99, top en 102.` ·
Ingresos JUN 324.807 · JUL 379.991 · AGO 91.537 · TOTAL 796.335.

**Efecto colateral:** esa primera corrida se comió el logo WE que estaba insertado a mano en
`A1:A2`. Arreglado a continuación.

## El encabezado hecho a mano ahora sobrevive al rebuild

`construirConsolidado()` borra la pestaña y la crea de nuevo. Eso le da hoja limpia gratis (sin
merges viejos ni grupos de filas apilándose corrida tras corrida), pero se lleva puesto todo lo
hecho a mano. Reconstruir *en el sitio* evitaría la pérdida a cambio de desarmar merges, grupos
y filas ocultas una por una: mucho estado sutil que romper. Se eligió lo barato: **seguir
borrando, pero copiar el encabezado a la hoja nueva antes de tirar la vieja.**

El contrato quedó así:

| Filas | Manda |
|---|---|
| **1–3** | el equipo, a mano (logo, banda de título, leyenda) |
| **4** | el script (fechas, oculta) |
| **5 → fin** | el script (tablero completo) |

Cómo funciona (`FILAS_ENCABEZADO = 3`):

1. La hoja nueva se crea con nombre temporal `Reporte Consolidado (nuevo)`; la vieja **no** se
   borra todavía.
2. Se construye y formatea el tablero entero.
3. `adoptarEncabezado(vieja, nueva)` copia filas 1–3 (valores, formato y merges vía `copyTo`)
   + las alturas de fila. Va **después** de `formatearConsolidado`, así lo hecho a mano pisa lo
   que escribió el script y no hace falta ninguna bandera.
4. `copiarImagenes()` aparte: `copyTo` **no** arrastra las imágenes sobre la cuadrícula y el
   logo es una de ellas. Se reinsertan por `getBlob()` respetando ancla, offsets y tamaño.
5. Recién ahí se borra la vieja y la nueva se renombra a `Reporte Consolidado`.

Si la corrida se cae entre el paso 1 y el 5 queda una pestaña `Reporte Consolidado (nuevo)`
visible — a propósito: es ruidoso pero no destructivo, el tablero bueno sigue en su lugar.

**Verificado**: corrida del 10/08 con encabezado presente → filas 1–3 intactas, sin pestaña
`(nuevo)` colgada, mismos totales. La copia de **imágenes** todavía no se probó con una imagen
real (el logo ya no estaba cuando se corrió); conviene confirmarlo la próxima vez que haya una.

---

# La guarda ahora bloquea al revés: el origen encogió (11/08/2026)

## Síntoma

Se corrigen `#N/A`/`#VALUE!` en el origen, se aprieta **Sincronizar**, y `Fuente Estatico`
sigue mostrando los errores viejos. Sin mensaje, sin alerta: parece que el botón no hace nada.

## Causa raíz

`Fuente Principal` = **3.058** filas · `Fuente Estatico` = **3.070** ya pegadas.

Al arreglar los `#N/A` se borraron ~13 filas basura del origen. `snapshotIncompleto()` compara
`valores.length < filasPrevias` y concluye "bloque truncado", exactamente como está escrito en
su comentario: *"El origen solo crece … menos filas que la copia anterior es SIEMPRE un bloque
truncado"*. Esa premisa **es falsa cuando alguien limpia datos malos.**

Dos defectos, no uno:

1. **Guarda binaria.** Un `IMPORTRANGE` truncado pierde *cientos* de filas; una corrección a
   mano pierde un puñado. La guarda trata igual −13 que −2.000.
2. **Bloqueo mudo.** El único rastro es un `console.log`. Quien aprieta Sincronizar desde la
   hoja no ve nada — el mismo modo de falla que congeló agosto una semana.

## Desbloqueo inmediato

`forzarPegado()` — ya existe y es justo para esto. `Fuente Principal` está sana
(A1 sin error, 3.058 filas), así que el pegado forzado es seguro.

## Parche permanente (`Código.gs`)

```js
// Merma del origen que se acepta sin sospechar de un pegado truncado.
var MERMA_TOLERADA = 0.02;

function snapshotIncompleto(valores, filasPrevias) {
  for (var i = 0; i < valores.length; i++) {
    if (valores[i][1] === '' || valores[i][1] === null) return 'fila ' + (i + 1) + ' sin fecha';
  }

  // Un IMPORTRANGE truncado pierde el bloque entero (cientos de filas); una correccion a mano
  // en el origen pierde un punado. Bloquear por cualquier merma dejaba el reporte congelado
  // para siempre cada vez que alguien borraba filas malas: solo la merma GRANDE es truncado.
  // Si la merma real supera la tolerancia, desbloquear a mano con forzarPegado().
  if (valores.length < filasPrevias * (1 - MERMA_TOLERADA)) {
    return valores.length + ' filas vs ' + filasPrevias + ' ya pegadas';
  }

  return null;
}
```

y en `sincronizarFuente()`, que el bloqueo deje de ser mudo:

```js
  if (motivo) {
    // Bloquear en silencio es lo que dejo el reporte congelado sin que nadie se entere:
    // el que aprieta Sincronizar solo ve que no pasa nada. Si no se pega, se avisa.
    avisar(':warning: *Reporte Diario*: snapshot incompleto (' + motivo + '). NO se actualizo ' +
      'Fuente Estatico. Si el origen encogio de verdad, correr forzarPegado(). ' + ss.getUrl());
    console.log('Snapshot incompleto (' + motivo + '). NO se toco Fuente Estatico: queda la copia anterior.');
    return;
  }
```

Con 3.058 vs 3.070 la merma es 0,4 % → pasa. Un truncado real de IMPORTRANGE sigue frenado.

---

# Los 4 descuadres contra "Ing. Operativos - GRUPO WE | 2026" (11/08/2026)

Ambos archivos cubren **las mismas filas** (diff fila a fila por fecha+correo+monto+curso: 0
sobrantes, 0 faltantes). Todo el descuadre es **cómo suma cada lado**.

El total verde del origen (`JULIO!D1`) no es un `SUMIF` sobre los datos: es
**`control PEN + control USD × TC`**, donde los controles son la suma de los bloques
(*Ventas Zoom, Cuotas Zoom, Ventas Online, In House, Convenio, Corporativo, Auspicio, Otro,
FUNDACIÓN WE, PAGOS EXTRAS*). Lo que no cae en un bloque, no existe para el origen.

| # | Qué | Julio | Agosto |
|---|---|---|---|
| 1 | `INHOUSE` sin espacio (fila N°1194, 31/07, MECATRONIC DHIGZA) — el bloque suma `IN HOUSE` | **+944,00** | — |
| 2 | `B2B / CONSULTORIA` (fila N°329, 07/08, USD 834,997) — el bloque de totales no tiene línea Consultoría | — | **+2.851,51** |
| 3 | `FUNDACIÓN WE` contada en su bloque **y** dentro de `PAGOS EXTRAS` | **−96,00** | — |
| 4 | TC: `Fuente Estatico!S` usa **3,415**, el origen **3,600** | **−715,36** | **−90,84** |
| | **Δ total** | **+132,64** | **+2.760,67** |

Un 5º descuadre —filas con `#N/A`/`#VALUE!` cuya categoría salía error y no la enganchaba
ningún `SUMIFS`, así que el pie del mes no cuadraba con sus propias líneas— se resolvió el
11/08 corrigiendo el origen y corriendo `forzarPegado()`. Ya no hay categorías con error.

## Decisión (11/08/2026): `Ing. Operativos` es la fuente oficial y NO se toca

El Reporte Diario tiene que dar **su** número: julio **379.858,20**, agosto **94.521,90**.
Los 3 defectos de la tabla de arriba son del origen y ahí se quedan, así que el reporte
**espeja** el total en vez de recalcularlo, y la diferencia contra el detalle queda **escrita
al lado** — no se borra plata ni se duplica en silencio.

## Cambios pendientes de aplicar

**`Fuente Estatico!S1`** — el TC es **mensual**, no una constante (jun 3,415 · jul 3,600 ·
ago 3,600), así que sale de una tabla:

```
=SI(J1="USD";P1*BUSCARV(AÑO(B1)*100+MES(B1);TC!$A:$B;2;FALSO);P1)
```

Pestaña **`Control`** — **creada y verificada el 11/08/2026**. Una fila por mes, y de paso el
ancla del cuadre. Los tres `IMPORTRANGE` ya resuelven: 324.806,52 · 379.858,20 · 94.521,90.

| A `aaaamm` | B `TC` | C `Total origen` |
|---|---|---|
| `202606` | `3,415` | `=IMPORTRANGE("<id origen>";"JUNIO!D10")` |
| `202607` | `3,6` | `=IMPORTRANGE("<id origen>";"JULIO!D10")` |
| `202608` | `3,6` | `=IMPORTRANGE("<id origen>";"AGOSTO!D10")` |

Mes nuevo = una fila. **Techo conocido:** `D10` es la celda del `ING. TOTALES` en cada pestaña
del origen; si mueven ese bloque hay que corregir la referencia.

**`Reporte Ingresos`, pie del mes (filas 52-63) — APLICADO el 11/08/2026:**

| Col | Fórmula (fila 58 = Julio) | Qué es |
|---|---|---|
| `C58` | `=SI.ERROR(BUSCARV(202607;Control!$A:$C;3;FALSO);0)` | **el total oficial** |
| `F58` | el `SUMAR.SI.CONJUNTO` que hoy está en `C58` | detalle de `Fuente Estatico` |
| `E58` | `=SI(C58=0;"";TEXTO(F58-C58;"+#,##0.00;-#,##0.00;\"cuadrado\""))` | la diferencia, a la vista |

`E` (Observaciones) ya existe y está vacía. `F58` evita repetir el `SUMIFS` dos veces en la
misma fila; sin eso, la celda de Observaciones sería el `SUMIFS` duplicado.

Hoy `E` diría `+848,00` en julio y `+3.005,99` en agosto. El día que el origen arregle sus
tres cosas, se va sola a `cuadrado`.

- Clave numérica `202607` y no texto `"2026-07"`: `AÑO()`/`MES()` digieren las fechas que
  llegan como texto desde el origen (hay varias, tipo `01/08/2026`); `TEXTO()` las devolvería
  tal cual y el `BUSCARV` fallaría.
- `FALSO` (exacto) y **sin `SI.ERROR`**: un mes nuevo sin TC revienta con `#N/A` a la vista en
  vez de multiplicar en silencio por el TC del mes anterior. Es un flujo de dinero.
- Pestaña aparte y no `Fuente Estatico!V:W`: hoy V está a salvo (el script escribe y limpia
  A:T), pero el día que el origen pase de `R` hay que correr `S` y `T` a la derecha y se
  comerían la tabla.

El origen también tiene el TC del mes en el `E1` de cada pestaña. Se descartó traerlo por
`IMPORTRANGE`: son 12 dependencias nuevas y haría que tocar un mes ya cerrado moviera el
histórico del reporte solo.

**`Fuente Estatico!T1`** — dos cambios, cada uno balanceado en paréntesis:

| Buscar | Reemplazar |
|---|---|
| `SI(F1="IN HOUSE";"B2B-INHOUSE"` | `SI(SUSTITUIR(F1;" ";"")="INHOUSE";"B2B-INHOUSE"` |
| `"B2B-EXTRAS"` | `SI(F1="CONSULTORIA";"B2B-CONSULT";"B2B-EXTRAS")` |

**Solo en `T1`.** Un buscar/reemplazar sobre toda la columna metería `F1` literal en las 3.058
filas; `forzarPegado()` arrastra `S1:T1` hacia abajo con las referencias relativas bien.

**`Reporte Ingresos!A32`** = `B2B-CONSULT` (la columna A está oculta; la fila "3. Consultoria"
ya existe pero sin clave, por eso `bloqueUnidades()` la marca `sinClave` y le escribe `=0`).

**En el origen**, por mes:
- Corregir `INHOUSE` → `IN HOUSE` en la fila del 31/07 (es un typo de dato: una celda contra
  una fórmula por pestaña).
- Agregar la línea **Consultoría** al bloque de totales, o meter `CONSULTORIA` en `6. Otro`.
- Sacar la línea `FUNDACIÓN WE` de `PAGOS EXTRAS`.

Después: `forzarPegado()` y luego `construirConsolidado()`.

---

# El reporte pasa a cubrir ENERO → hoy (13/08/2026)

Antes cubría junio–agosto. Ahora los 12 meses, con datos hasta agosto.
Todo el cambio está en `reporte-diario-extender-matriz.gs` (función `ampliarDesdeEnero()`,
idempotente); en el proyecto vive como `ampliar-desde-enero.gs`.

## El bug que bloqueaba todo: `#VALUE!` en `Fuente Principal!A1`

Al ampliar `A1` a 8 `IMPORTRANGE` apilados con `{}`, la celda entera caía en
**`ARRAY_LITERAL: faltaban valores`** y el pipeline quedaba muerto — el snapshot seguía
congelado en junio y los dos reportes leen del snapshot, no del `IMPORTRANGE`.

Causa: un literal de matriz exige el **mismo ancho** en todos los bloques, y las pestañas
del origen no lo tienen. Medido, no supuesto:

| Pestaña | `maxCols` |
|---|---|
| ENERO, FEBRERO | **17** (llegan a `Q`) |
| MARZO | 37 (`lastCol` 18) |
| ABRIL … AGOSTO | 19 |

La columna 18 es `WE PLUS-DESC`, que el origen agregó en agosto: los meses viejos nunca la
tuvieron. Y al pedir `A30:R3000` de una hoja que termina en `Q`, **Sheets recorta el rango
en silencio** en vez de dar `#REF!` → 17 columnas → revienta el apilado.

Arreglo (en la fórmula; el origen es archivo oficial y no se toca): las pestañas angostas se
rellenan hasta 18 columnas con

```
{IMPORTRANGE(id;"ENERO!A30:Q5000") \ ARRAYFORMULA(IF(IMPORTRANGE(id;"ENERO!A30:A5000")<>"";"";""))}
```

**No** con `QUERY(...;"select Col1,…,Col17,''")`: el Query Language no admite literales de
cadena en el `select` y devuelve `#N/A`. Se descubrió midiendo con `COLUMNS()` en una hoja
temporal (`probarAncho()`), que es la única forma de ver el ancho *entregado* y no el declarado.

**Segundo hallazgo, no buscado:** el rango cortaba en la fila **3000** y las pestañas ya llegan
a la **3254** — truncaba ~250 filas por mes sin avisar. Subido a 5000.

## Extender la matriz hacia atrás salió casi gratis

`Reporte Ingresos` estaba anclado en 01/06/2026. En vez de insertar 22 bloques a la izquierda
(rompería `B1`, la cadena de fechas y los `SUMIFS`), se **movió el ancla**: `C1` pasó a
`DATE(2025;12;29)` y se extendió a la derecha hasta 36 semanas. Como la fila 1 es una cadena
(`solo C1 es literal, el resto es "= la anterior + 1"`), toda la matriz se recorrió sola y las
14 semanas que ya existían cayeron en las posiciones 23–36 con sus mismas fechas. Cero pérdida.

`29/12/2025 + 154 días = 01/06/2026`, o sea 22 semanas exactas. El diseño ya admitía mover el
origen del tiempo aunque se escribió pensando solo en crecer hacia adelante.

## TC mensual (antes era una constante)

`Fuente Estatico!S1` convertía todo USD a **3,415** fijo. Ahora sale de `Control` por mes:

```
=IF(J1="USD";P1*VLOOKUP(YEAR(B1)*100+MONTH(B1);Control!$A:$B;2;FALSE);P1)
```

TC oficial cargado (finanzas, 13/08/2026): ene 3,355 · feb 3,361 · mar 3,495 · abr 3,529 ·
may 3,417 · jun 3,415 · jul **3,399** · ago 3,600.

**Julio bajó de 3,600 a 3,399**: mueve el monto en soles de las ventas en USD de un mes ya
publicado. Es dato de finanzas, no un efecto colateral.

## Otros cambios

- `Control`: 8 filas (`aaaamm`, TC, `=IMPORTRANGE(origen;"MES!D10")` = total oficial).
- `Reporte Ingresos` filas 52–63: el pie del mes ahora cubre **los 12 meses**
  (C = total oficial, F = detalle de `Fuente Estatico`, E = la diferencia a la vista).
  La col F heredaba **formato de porcentaje** (`54664347%` donde va `S/546.643,47`); el valor
  siempre estuvo bien, era el formato.
- `Fuente Estatico` se amplió de ~3.000 a **10.112** filas: `pegar()` escribe por
  `getRange(fila, col, n, …)` y revienta si la hoja no tiene esas filas creadas.

## Resultado verificado

```
Fuente Principal: 10.012 filas — {01:1725, 02:1481, 03:1436, 04:1163,
                                  05:1066, 06:1281, 07:1193, 08:667}
FORZADO: pegadas 10012 filas (antes había 3141).
```

Pie del mes (oficial · trx · diferencia contra el detalle):

| Mes | Oficial | Trx | Δ |
|---|---|---|---|
| ENERO | 546.643,47 | 1.600 | cuadrado |
| FEBRERO | 389.859,30 | 1.355 | −235,00 |
| MARZO | 390.349,39 | 1.307 | +212,00 |
| ABRIL | 323.387,63 | 1.050 | +212,00 |
| MAYO | 277.725,11 | 939 | −0,00 |
| JUNIO | 324.806,52 | 1.078 | −0,00 |
| JULIO | 379.928,97 | 1.069 | +0,00 |
| AGOSTO | 109.842,20 | 380 | +13.493,83 |

`Reporte Consolidado`: ENE 546.643 · FEB 389.624 · MAR 390.561 · ABR 323.600 · MAY 277.725 ·
JUN 324.807 · JUL 379.929 · AGO 123.336 → **TOTAL S/2.756.225**, 8.778 transacciones.
Checksum `B1` de la matriz: S/2.730.886.

El Δ de agosto es el mes en curso: el `D10` del origen todavía no incorpora todo lo que sí
está en el detalle. Los meses cerrados cuadran salvo ±235 (los 3 defectos del origen ya
documentados más arriba).

## La leyenda del tablero (corregida a mano el 13/08/2026)

`Reporte Consolidado!A3` decía *"USD convertido a 3,415"*, que dejó de ser cierto al pasar el
TC a mensual. Ahora dice:

```
Fuente: hoja Fuente Estatico  |  montos en soles, USD convertido al TC del mes (hoja Control)  |  se actualiza solo con el sync
```

Se escribió **directamente en la celda**, no por script: la fila 3 es del encabezado que
mantiene el equipo y que `construirConsolidado()` preserva vía `adoptarEncabezado()`, así que
sobrevive a los rebuilds. `actualizarLeyenda()` existe en el `.gs` del repo (busca por
contenido, no por celda fija, porque la fila 3 va con merges) pero **no se llegó a subir al
proyecto**: el portapapeles se pisó dos veces a mitad del pegado. Si hace falta correrla,
subir el archivo del repo primero.

## Pendiente

- **El proyecto y el repo divergen** en `ampliar-desde-enero.gs`: al proyecto le faltan
  `actualizarLeyenda()` y el `paso()` apunta a los últimos helpers en vez de a
  `ampliarDesdeEnero()`. Es andamiaje inerte —nadie lo dispara solo— pero conviene subir el
  archivo del repo entero la próxima vez que se toque.
- **Techo conocido:** 36 bloques × 16 columnas × 43 filas de `SUMIFS` sobre 10.000 filas hace
  que `Reporte Ingresos` tarde en recalcular; al abrirlo la pestaña se congela unos segundos.
  Si molesta, lo que sobra es el detalle diario de los meses cerrados: bajar `SEMANAS` y dejar
  sólo el pie del mes para lo viejo.

---

# El Consolidado ya espeja el total oficial (13/08/2026)

La decisión del 11/08 —*el reporte espeja `Ing. Operativos` en vez de recalcularlo*— se había
aplicado al **pie de `Reporte Ingresos`** pero no al Consolidado: su fila `Ingresos` seguía
siendo un `SUMIFS` sobre `Fuente Estatico`. El `INDEX` al pie ya estaba escrito **en la copia
del repo**, con su comentario; nunca se subió al proyecto. Por eso los dos reportes del mismo
archivo mostraban cifras distintas y nadie tenía la culpa.

```js
{ k: 'ing', …, f: "=INDEX('" + diario.getName() + "'!$C$52:$C$63;MONTH(C$4))", o: 'SUMA' },
```

El descuadre visible era exactamente la tabla de diferencias ya documentada arriba
(FEB −235 · MAR/ABR +212 · AGO +13.494).

| | antes (`SUMIFS`) | ahora (`INDEX` al pie) |
|---|---|---|
| TOTAL | S/2.759.779 | **S/2.746.853** = el pie |
| AGOSTO | 127.475 | **113.981** |
| No clasificado (checksum) | 23.759 | **10.832**, y jul/ago en **0** |

**El checksum lo confirma**: agosto pasó a `0` porque el total oficial coincide exacto con la
suma de las 5 unidades — los S/13.494 de diferencia eran justamente las ventas sin categoría en
`T`, las mismas que el `D10` del origen todavía no incorpora. No se perdió plata: cambió de
"ingreso sin clasificar" a "todavía no está en el oficial".

**Techo conocido:** el bloque de unidades, transacciones y alumnos siguen saliendo de
`Fuente Estatico`. Es a propósito (el oficial es un total, no tiene detalle), y la fila
*No clasificado* es la que hace visible la brecha. Si un día ese residuo se dispara, el problema
está en la columna `T`, no en el tablero.

## Nota de método

Editar este proyecto por automatización de navegador tiene dos trampas caras:

1. **El selector de "Ejecutar" no acepta que le cambien la opción por click.** Toma la primera
   función del archivo activo, y sólo cambia al cambiar de archivo. Por eso el punto de entrada
   se llama `paso()` y va primero — el mismo truco que ya usaba `diagnostico()` en `Codigo.gs`.
2. **El portapapeles es compartido con el usuario.** Dos veces se pisó entre el `Set-Clipboard`
   y el `Ctrl+V`, y una de ellas dejó una URL dentro del archivo. Verificar el largo del modelo
   antes y después de cada pegado, y comprobar que el editor activo **no** es `Codigo.gs` antes
   de seleccionar todo.

---

# Agosto: la Fundación cae en "No clasificado" (24/08/2026)

## Síntoma

`Reporte Consolidado`, bloque **FUNDACIÓN WE**: *1. Tickets Eventos* muestra **S/.0 en agosto**
(ene 22.875 · feb 2.160 · mar 12.078 · may 12.968 · jun 24.596) mientras la fila
*No clasificado (fuera de las 5 unidades)* salta a **S/.5.408** — el único mes con residuo
desde junio.

## Causa raíz: el origen cambió de vocabulario en agosto

Las 31 ventas de fundación de agosto (V CONGRESO DE DIRECCIÓN DE PROYECTOS) llegan a
`Fuente Estatico` etiquetadas distinto que todos los meses anteriores:

| | col `E` (unidad) | col `F` (subtipo) | col `T` (categoría) |
|---|---|---|---|
| ene → jun | `FUNDACIÓN WE` | `EVENTOS` | `FUND-EVENTOS` |
| **ago** | `FUNDACION` | `EVENTO` | **`REVISAR`** |

`Fuente Estatico!T1` compara contra los literales **exactos**, así que agosto cae en el
`REVISAR` del final de la cadena. `REVISAR` no lo engancha **ningún** `SUMIFS` de
`Reporte Ingresos` (la clave de la fila es `FUND-EVENTOS`, col A oculta, fila 45), y por eso
el dinero desaparece del bloque de unidades y reaparece como residuo.

Medido sobre el snapshot (10.274 filas):

```
filas con FUND* en E/F, por mes: {01:141, 02:27, 03:93, 05:48, 06:150, 08:31}
categorías vistas en esas filas:  FUND-EVENTOS · FUND-EXTRAS · REVISAR
REVISAR por mes (monto col S):    {2026-08: 5.645}   <- no hay REVISAR en ningún otro mes
```

Los S/5.645 de `REVISAR` y los S/5.408 de *No clasificado* no son el mismo número a
propósito: la fila de residuo se calcula contra el **total oficial** (`INDEX` al pie de
`Reporte Ingresos`, decisión del 13/08), no contra la suma del detalle.

## Arreglo aplicado (misma receta que el typo `INHOUSE`)

El origen es archivo oficial y no se toca, así que la normalización va **solo en `T1`**: un
buscar/reemplazar sobre toda la columna metería `E1`/`F1` literal en las 10.000 filas.

La rama que fallaba era

```
IF(E1="FUNDACIÓN WE";IF(F1="EVENTOS";"FUND-EVENTOS";"FUND-EXTRAS"); …
```

y quedó

```
IF(LEFT(E1;4)="FUND";IF(LEFT(F1;6)="EVENTO";"FUND-EVENTOS";"FUND-EXTRAS"); …
```

Cubre `FUNDACION`/`FUNDACIÓN WE` y `EVENTO`/`EVENTOS` de una vez y deja de depender de la
tilde, que es justo lo que se rompió. Los **nombres de función van en inglés** (`LEFT`, no
`IZQUIERDA`): `getFormula()`/`setFormula()` hablan inglés aunque el locale del archivo use
`;` como separador.

El reemplazo se hizo **por script, no a mano**, y sobre el texto que devuelve `getFormula()`,
con guarda de que el `replace` haya cambiado algo antes de escribir:

```js
var t1 = fe.getRange('T1').getFormula();
var nuevo = t1.replace(/E1="FUNDACI.N WE"/, 'LEFT(E1;4)="FUND"')
              .replace('F1="EVENTOS"', 'LEFT(F1;6)="EVENTO"');
if (nuevo === t1) { console.log('T1 no cambio: abortado'); return; }
fe.getRange('T1').setFormula(nuevo);
```

El `.` del regex evita tener que tipear la `Ó` por automatización de teclado.

Para bajar la fórmula nueva a las 10.288 filas **no hace falta `forzarPegado()`**: alcanza con
copiar `T1` sobre el resto de la columna, que es lo único que cambió.

```js
fe.getRange('T1').copyTo(fe.getRange(2, 20, fe.getLastRow() - 1, 1));
```

Re-pegar las 10.000 × 18 celdas del snapshot para arreglar una columna es superficie de
riesgo gratis — y `construirConsolidado()` ya se cayó una vez por `Service Spreadsheets
timed out` esa misma tarde. Tampoco hizo falta regenerar el tablero: sus filas son `SUMIFS`
vivos y se movieron solas.

### Resultado verificado

```
Categoria rehecha en 10288 filas. Quedan 0 con REVISAR.
```

`Reporte Consolidado`, bloque FUNDACIÓN WE:

| | ene | feb | mar | abr | may | jun | jul | **ago** | TOTAL |
|---|---|---|---|---|---|---|---|---|---|
| 1. Tickets Eventos | 22.875 | 2.160 | 12.078 | – | 12.968 | 24.596 | – | **5.970** | 80.647 |
| SUBTOTAL - FUNDACIÓN | 22.875 | 2.160 | 13.228 | – | 12.968 | 24.816 | – | **5.970** | 82.017 |

**Ojo con el residuo:** *No clasificado* pasó en agosto de **+5.408** a **−3.552**. No es un
defecto nuevo: la fila es `oficial − Σ subtotales` y agosto es el mes en curso, así que el
`D10` del origen todavía va atrás del detalle (es la misma brecha que el pie del mes ya
mostraba como `+13.494` el 13/08). Cuando el mes cierre debería volver a cero o cerca.

**Techo conocido:** esto tapa el síntoma, no la causa. Cada mes nuevo del origen puede
estrenar otra grafía y el único aviso es que el residuo de *No clasificado* se mueva. Un
`REVISAR` con monto > 0 debería alertar por Slack como ya lo hace `snapshotIncompleto`.

## Nota de método (24/08): la UI del Sheet no se puede automatizar hoy

`Reporte Ingresos` recalcula 36 bloques × 43 filas de `SUMIFS` sobre 10.000 filas: la pestaña
queda congelada y **los clicks sintéticos sobre menús no abren submenús** (ni `Ver > Hojas
ocultas` en el Sheet, ni `+ Archivo` en Apps Script). Sólo responden botones simples y el
editor Monaco.

Dos consecuencias que costaron caro:

1. El selector de **Ejecutar** no aceptó el click sobre `verT1` y volvió a su valor previo:
   se corrió **`construirConsolidado()`** sin querer. Se cayó con
   `Service Spreadsheets timed out` en `bloqueUnidades` — *después* del `insertSheet`, así que
   **dejó la pestaña `Reporte Consolidado (nuevo)` colgada**. El tablero bueno quedó intacto y
   la pestaña se borró desde el mismo script.
2. El desplegable **abre** pero no acepta el click sobre el ítem, así que no hay forma de
   elegir qué función corre. Lo que sí funciona: **redefinir la función que el selector ya
   tiene elegida**, al final del archivo. En JS gana la última declaración, así que un
   `function paso() { … }` al pie del archivo se ejecuta en lugar del original sin tocarlo.
   Al terminar, se borra y el original vuelve solo.
3. Los clicks dentro de Monaco caen **unas líneas más arriba** de lo que muestra la captura
   (dos veces metieron la función adentro del bloque `/** … */`). Posicionar con **teclado**
   —`ctrl+Home`, `Down` × n, `shift+Home` × 4 para tomar la línea lógica entera— es lo único
   fiable. `shift+Home` hay que repetirlo: con word-wrap, la primera vez va al principio de la
   línea *visual*.

---

# Fuera la fila "No clasificado" y aparece Consultoría (25/08/2026)

## 1. Se eliminó *No clasificado (fuera de las 5 unidades)*

La fila era `total oficial − Σ subtotales`: un checksum útil mientras se cazaba la brecha
entre `Ing. Operativos` y el detalle, pero **en el tablero del día a día es ruido** — mezcla
dos cosas distintas (ventas sin categoría en `T` y el desfase del mes en curso) y, con agosto
abierto, llegó a mostrar un residuo **negativo**, que no significa nada para quien lee el
reporte.

Tres borrados en `construirConsolidado()` (`Código.gs`), ninguno opcional:

| Qué | Por qué |
|---|---|
| `var RESTO_C` / `var RESTO_O` | eran las fórmulas de esa fila y nadie más las usa |
| `{ k: 'nocl', … }` en `F` | la fila |
| `'nocl'` en el `forEach` del log final | `fila['nocl']` sería `undefined` y `getRange(undefined, …)` revienta **al final** de la corrida, con el tablero ya escrito |

`UNI.subs` sigue devolviéndose: es de donde salen las claves `sub0..subN` de las filas
SUBTOTAL, no era sólo para el residuo.

El checksum no se pierde: `Reporte Ingresos` filas 52-63 sigue teniendo la columna `E` con la
diferencia contra el total oficial, que es donde corresponde mirarla.

## 2. "3. Consultoria" ya no sale en S/.0

`Fuente Estatico!T1` **ya** clasificaba bien (las 5 ventas tienen `B2B-CONSULT` desde
siempre), pero **`Reporte Ingresos!A32` estaba vacía**. Sin clave en la columna A,
`bloqueUnidades()` marca la fila `sinClave` y le escribe `=0` — falla silenciosa perfecta: la
fila existe, tiene etiqueta y muestra un cero creíble.

Era el pendiente del 11/08 que se aplicó a medias: la mitad de `T1` sí, la clave de la hoja
no.

```js
hojaIngresos(ss).getRange('A32').setValue('B2B-CONSULT');
```

Después hay que correr **`construirConsolidado()`**: a diferencia de un cambio en `T1`, la
taxonomía se lee en el rebuild (`bloqueUnidades` deja el `=0` escrito en la celda), así que el
tablero no se arregla solo.

### Resultado

| 3. Consultoria | ene | feb | mar | abr | may | jun | jul | ago | TOTAL |
|---|---|---|---|---|---|---|---|---|---|
| antes | – | – | – | – | – | – | – | – | **S/.0** |
| ahora | – | – | – | 2.643 | **853** | – | – | 13.778 | **S/.17.273** |

Cuadra al céntimo con las 5 ventas de `CONSULTORIA` del snapshot (2.642,52 + 852,88 +
3.289,87 + 1.259 + 9.228,84). `SUBTOTAL - B2B` sube de S/.340.342 a **S/.357.615**.

**Pendiente del mismo lote:** `Reporte Ingresos!A33` ("4. Ingresos Extras" de Categorías
Propias) también está sin clave; hoy `B2B-EXTRAS` cuelga de `A38` ("11. Ingresos Extras").
Si alguien quiere separarlos hay que decidir primero qué va en cada una.

## Nota de método: el buscador de Monaco resuelve el posicionamiento

Los clicks en el editor caen unas líneas arriba y contar `Down` falla en cuanto una línea
envuelve. Lo que sí es exacto: **`ctrl+f` → texto → `Enter` → `Escape`** deja el cursor sobre
la coincidencia. Desde ahí, `End` + `shift+Home` × 4 toma la línea lógica entera. Incluir en
la búsqueda lo que sobra (`'nocl', ` con la coma y el espacio) deja el borrado en un solo
`Delete`. `ctrl+h` no llegó a abrirse nunca; `ctrl+f` sí.
