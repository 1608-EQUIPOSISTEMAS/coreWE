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
