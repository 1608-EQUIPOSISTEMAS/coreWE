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
