# Criterios de prioridad para tickets

Este documento define cómo se clasifica automáticamente la prioridad (ALTA, MEDIA o BAJA) de un ticket a partir de su título y su problemática.

La clasificación la hace el código leyendo este archivo: la prosa de cada sección es documentación para las personas, y los bloques **Palabras clave** son lo que el clasificador realmente usa. Para ajustar cómo se clasifican los tickets basta con editar esas listas — no hay que tocar código ni volver a desplegar nada más que este archivo.

## Cómo se decide

1. Se normaliza el texto del ticket (título + problemática): minúsculas y sin tildes.
2. Por cada prioridad se busca cuáles de sus palabras clave aparecen en ese texto. Una palabra clave coincide aunque venga con sufijo: `venta` también coincide con `ventas`.
3. Cada coincidencia suma tantos puntos como palabras tenga la frase clave. Así una frase específica de varias palabras (`agregar un campo`) pesa más que un término suelto (`erp`), que por sí solo no dice si es una falla o una mejora.
4. **Una falla operativa manda sobre todo lo demás.** Si el ticket coincide con alguna palabra clave de ALTA de dos o más palabras — es decir, describe una falla concreta y no solo nombra el sistema — se clasifica ALTA aunque de paso pida una mejora o mencione una hoja de cálculo. Un ticket que dice "el ERP no responde y además quisiera un reporte nuevo" es ALTA: lo que bloquea la operación se atiende primero.
5. Si no se dio el punto anterior, gana la prioridad con más puntos. Si hay empate, o si no coincide ninguna palabra clave, el ticket queda en **MEDIA**.

## ALTA (urgente)

Cualquier problema que afecte el **funcionamiento operativo del ERP** — el sistema interno que la empresa usa día a día para registrar y procesar su operación (ventas, inscripciones, matrículas, pagos, etc.). Se considera ALTA cuando el ERP falla, se traba, o hay incertidumbre sobre si una operación se registró correctamente.

**Ejemplos que son ALTA:**
- Una venta o inscripción no se registró, no pasó, o no se sabe si se guardó correctamente.
- El sistema se queda colgado o no responde mientras se está usando.
- Un error impide completar un registro, pago o proceso en el ERP.
- Datos que deberían estar guardados y no aparecen, o aparecen mal.

**No es ALTA:** pedidos de mejoras, nuevas funcionalidades o cambios visuales sobre el ERP — esos van a BAJA (ver abajo), aunque se refieran al ERP, porque no bloquean ni afectan la operación actual.

### Palabras clave

- erp
- sistema
- no se registro
- no se guardo
- no quedo registrado
- no se grabo
- no aparece registrada
- no paso la venta
- no se proceso
- no puedo registrar
- no puedo guardar
- no puedo facturar
- no puedo cobrar
- no deja guardar
- no deja registrar
- no deja avanzar
- no me deja continuar
- se queda colgado
- se quedo colgado
- se cuelga
- se traba
- se congela
- no responde
- no carga
- no abre el sistema
- se cayo el sistema
- sistema caido
- esta caido
- error al guardar
- error al registrar
- error al procesar
- da error
- me sale error
- pantalla en blanco
- no se si se guardo
- no se si se registro
- se perdio la informacion
- se perdieron los datos
- datos incorrectos en el sistema
- no aparecen los datos
- matricula no se registro
- inscripcion no se registro
- pago no se registro
- venta no se registro
- urgente no puedo trabajar
- nadie puede trabajar
- todo el area esta parada

## MEDIA

Problemas con herramientas de oficina (Google Sheets, Excel, Google Docs, Word, etc.) que **afectan el trabajo pero no tienen una solución simple o conocida** — hay que investigar, revisar fórmulas, permisos, datos corruptos, etc.

**Ejemplos que son MEDIA:**
- Una hoja de Google Sheets con fórmulas que dan resultados incorrectos.
- Un archivo de Excel o Sheets que no comparte permisos correctamente.
- Datos que se ven mal o se perdieron en una hoja de cálculo compartida.

### Palabras clave

- google sheets
- hoja de calculo
- spreadsheet
- google docs
- google drive
- drive compartido
- formula
- formulas
- tabla dinamica
- macro
- filtro no funciona
- resultado incorrecto
- calculo incorrecto
- suma mal
- no calcula bien
- da un resultado raro
- celdas
- columna
- permisos del archivo
- no tengo acceso al archivo
- no puedo compartir
- no me deja editar el documento
- archivo compartido
- se desconfiguro la hoja
- datos duplicados
- importar datos
- exportar a excel

## BAJA

Dos casos:

1. **Mejoras o implementaciones sobre el ERP** que no son fallas — agregar un campo o una opción a un formulario, mejorar cómo se muestra la información, nuevas funcionalidades solicitadas. No afectan la venta ni la operación actual, solo la mejoran a futuro.
2. **Problemas menores de aplicaciones de escritorio con solución simple y ya conocida** — por ejemplo, Excel de escritorio que no abre y cuya solución habitual es reinstalar la aplicación. Molestias puntuales sin mayor complejidad.

**Ejemplos que son BAJA:**
- "Agregar un campo de observaciones al formulario de matrícula del ERP."
- "Mejorar cómo se ve el listado de alumnos en el ERP."
- "El Excel de escritorio no abre" (cuando la causa es conocida y la solución es reinstalar).

### Palabras clave

- agregar un campo
- agregar una opcion
- agregar un boton
- agregar una columna al reporte
- añadir un campo
- se podria agregar
- se puede agregar
- quisiera que se agregue
- nos gustaria que
- seria bueno que
- solicito que se implemente
- nueva funcionalidad
- nuevo modulo
- nuevo reporte
- implementar una opcion
- mejorar como se ve
- mejorar la vista
- mejorar el diseño
- mejorar el listado
- cambiar el color
- cambiar el orden de
- cambio visual
- sugerencia de mejora
- propuesta de mejora
- solicitud de mejora
- reinstalar
- desinstalar e instalar
- instalar el programa
- instalar office
- instalar la aplicacion
- no abre el excel de escritorio
- excel de escritorio no abre
- actualizar la version
- cambiar el mouse
- cambiar el teclado
- no imprime
- la impresora
- configurar la impresora
- configurar el correo
- cambiar de contraseña de windows
- licencia de office

## Cuando hay duda

Si el ticket no calza claramente en ninguna categoría, o mezcla varios temas en partes iguales, queda como **MEDIA** por defecto.
