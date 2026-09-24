# Criterios de prioridad para tickets

Este documento define cómo se clasifica automáticamente la prioridad (ALTA, MEDIA o BAJA) de un ticket a partir de su título y su problemática.

La clasificación la hace el código leyendo este archivo: la prosa de cada sección es documentación para las personas, y los bloques **Palabras clave** son lo que el clasificador realmente usa. Para ajustar cómo se clasifican los tickets basta con editar esas listas — no hay que tocar código ni volver a desplegar nada más que este archivo.

Los criterios salen del cuadro **Niveles de incidencias — Sistemas WE**: la matriz urgencia × impacto, el catálogo de ítems por área y el histórico de tickets ya priorizados.

## Cómo se decide

1. Se normaliza el texto del ticket (título + problemática): minúsculas y sin tildes.
2. Por cada prioridad se busca cuáles de sus palabras clave aparecen en ese texto. Una palabra clave coincide aunque venga con sufijo: `venta` también coincide con `ventas`.
3. Cada coincidencia suma tantos puntos como palabras tenga la frase clave. Así una frase específica de varias palabras (`agregar un campo`) pesa más que un término suelto (`convenio`), que por sí solo no dice si es una falla o una mejora.

   Por eso `erp`, `sistema` y `nexus` **no** son palabras clave de ninguna prioridad: casi todos los tickets nombran el sistema, así que nombrarlo no aporta nada para distinguirlos. Lo que clasifica es qué le pasa al sistema, no que se lo mencione. Lo mismo pasó con `cronograma` y `odoo`: se probaron y solo agregaron ruido, porque los nombra tanto un P1 como una consulta.
4. **Una falla operativa manda sobre todo lo demás.** Si el ticket coincide con alguna palabra clave de ALTA de dos o más palabras — es decir, describe una falla concreta y no solo nombra el sistema — se clasifica ALTA aunque de paso pida una mejora o mencione una hoja de cálculo. Un ticket que dice "el ERP no responde y además quisiera un reporte nuevo" es ALTA: lo que bloquea la operación se atiende primero.
5. Si no se dio el punto anterior, gana la prioridad con más puntos. Si hay empate, o si no coincide ninguna palabra clave, el ticket queda en **MEDIA**.

La palabra **urgente** no es palabra clave de nada, a propósito: la prioridad no la elige quien reporta, justamente para que nadie pueda adelantar su ticket escribiéndola.

### Cómo se afinaron estas listas

Las palabras clave se contrastaron contra los 331 tickets del histórico de la hoja, comparando la prioridad que da este archivo con la que se les asignó en su momento (P1 y P2 = ALTA, P3 = MEDIA, P4 = BAJA). Al agregar una palabra clave conviene repetir ese ejercicio: una frase que suena razonable puede estar arrastrando tickets de más. El criterio al elegir fue preferir frases de varias palabras que describan **qué pasó** antes que sustantivos sueltos que solo nombran **de qué se habla**.

## Urgencia, impacto y prioridad

En el cuadro de Sistemas WE la prioridad no se elige: sale de cruzar **cuán apurado es** (urgencia) con **a cuánto del negocio afecta** (impacto).

| Urgencia | Cuándo aplica |
| --- | --- |
| Crítica | Bloquea ahora un cobro, una venta o una clase en curso. |
| Alta | Afecta la operación del día; sin solución hoy hay retraso visible. |
| Media | Puede esperar días sin afectar clientes ni cierres. |
| Baja | Consulta, mejora o pedido sin fecha comprometida. |

| Impacto | Cuándo aplica |
| --- | --- |
| Crítico | Dinero, ventas, ingresos operativos o muchos alumnos. |
| Alto | Un área completa o un reporte de gerencia. |
| Medio | Una persona, un curso o un grupo pequeño. |
| Bajo | Cosmético o de uso interno sin efecto en el negocio. |

| Urgencia \ Impacto | Crítico | Alto | Medio | Bajo |
| --- | --- | --- | --- | --- |
| **Crítica** | P1 | P1 | P1 | P2 |
| **Alta** | P1 | P1 | P2 | P3 |
| **Media** | P1 | P2 | P3 | P4 |
| **Baja** | P2 | P3 | P4 | P4 |

Los SLA corren solo en horario hábil (lunes a viernes, 09:00–18:00 hora de Lima):

| Prioridad | SLA respuesta | SLA resolución | Equivale en este archivo a |
| --- | --- | --- | --- |
| P1 | 15 minutos | 4 horas hábiles | **ALTA** |
| P2 | 30 minutos | 1 día hábil | **ALTA** |
| P3 | 1 hora | 3 días hábiles | **MEDIA** |
| P4 | 4 horas hábiles | 5 días hábiles | **BAJA** |

El clasificador trabaja con tres niveles, no con cuatro: **P1 y P2 caen juntos en ALTA** porque ambos se atienden el mismo día y la diferencia entre 15 y 30 minutos de respuesta la define quien toma el ticket, no el texto con que se reportó.

## ALTA (urgente)

Equivale a **P1 y P2**. Todo lo que toca **dinero, ventas, ingresos operativos o el funcionamiento del sistema** — el ERP y Nexus, que la empresa usa día a día para registrar y procesar su operación (ventas, inscripciones, matrículas, pagos, cobranza, aulas). Es ALTA cuando el sistema falla, se cae, se traba, hay incertidumbre sobre si una operación se registró, o cuando las cifras que ve gerencia no cuadran.

**Ejemplos que son ALTA (tomados del histórico):**
- "Venta de julio registrada no jala a ingresos operativos."
- "Base de IO de enero se cayó (faltaban ~S/100 mil)."
- "Reportan que Nexus se cayó" / "se cayó todo el sistema (ERP)."
- "No jala ningún convenio/empresa al registrar venta."
- "Error al registrar inscripciones B2B con opción Orden de Compra."
- "Cuotas de members Black no jalan a la base de cuentas por cobrar."
- "Objetivos del ERP y del Sheets no cuadran."
- "Módulo Planificación no muestra los datos en producción."
- "El internet de la oficina está fallando" (nadie puede trabajar).

**No es ALTA:** pedidos de mejoras, nuevas funcionalidades o cambios visuales sobre el ERP, ni correcciones puntuales de un alumno o un curso — esos van a BAJA y MEDIA respectivamente, aunque se refieran al ERP, porque no bloquean la operación ni tocan el dinero.

### Palabras clave

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
- no permite guardar
- no permite completar
- no permite registrar
- error al registrar la venta
- error al registrar inscripcion
- error al registrar inscripciones
- se queda colgado
- se quedo colgado
- se cuelga
- se traba
- se congela
- no responde
- no carga
- no abre el sistema
- se cayo
- se cayo el sistema
- se cayo la base
- se cayo el internet
- sin internet
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
- no aparecen en el erp
- no figuran en el erp
- no ve nada
- no muestra los datos
- no muestra alumnos
- desaparecio el modulo
- modulo vacio
- ya no puede ver
- sin almacenamiento
- matricula no se registro
- inscripcion no se registro
- pago no se registro
- venta no se registro
- no puedo ingresar al sistema
- no puede ingresar al sistema
- no puedo ingresar al erp
- no puede ingresar al erp
- no me deja ingresar
- perdio el acceso al curso
- se cerro el acceso al curso
- ingresos operativos
- no jala a io
- no jala a ingresos
- no jala al dashboard
- no jala al reporte
- no jala al plan
- no jalan al plan
- no jala la venta
- no jalan las ventas
- no jala ningun
- no jala la empresa
- suma a io
- suman a io
- sumen a io
- base de io
- bases io
- hoja de io
- de io
- sin pago
- formula de ingresos
- lista de asistentes del congreso
- cuentas por cobrar
- comisiones por asesor
- comisiones del periodo
- total comision
- calculo de comisiones
- conciliacion
- ajustar montos
- actualizar montos
- enlace de pago
- pago a docentes
- figura valor 0
- egresos
- desglosar gasto
- horario pico
- solo jala
- error ref
- datos cruzados
- no se dejan corregir
- se desactivo
- antes del inicio
- configurar certificados
- cerro el acceso
- verificador
- no cuadra
- no cuadran
- cuadrar formulas
- cuadrar la formula
- descuadrado
- descuadrados
- no suman bien
- no suma bien
- no suma columnas
- cuadre de cifras
- reporte diario
- reporte consolidado
- reporte comercial
- reporte de gastos
- reporte muestra 0
- error en el reporte
- error en la formula
- jala mal el reporte
- faltan ventas
- falta ventas en el reporte
- ventas no aparecen
- venta no aparece
- no salen como confirmadas
- convenio
- no aparece la empresa
- no sale la empresa
- empresa no aparece
- convenio no aparece
- no jala el convenio
- control de ventas
- base de io
- base de ingresos
- certificados del congreso
- generar certificados
- emitir certificados
- regenerar certificados
- certificados de participacion
- certificados online
- certificado no se genero
- no puedo certificar
- no puedo subir la nota
- credencial
- credenciales
- credenciales del congreso
- ingresos
- planeamiento
- curso no se activo
- no enviaron correo
- correo no enviado
- no se envio el correo
- no puede enviar correos
- correos masivos
- el internet
- clase en curso
- aula no abre
- urgente no puedo trabajar
- nadie puede trabajar
- todo el area esta parada

## MEDIA

Equivale a **P3**: afecta a **una persona, un curso o un grupo pequeño**, o es un pedido operativo que puede esperar días sin afectar clientes ni cierres. También entran aquí los problemas con herramientas de oficina (Google Sheets, Excel, Google Docs) que **afectan el trabajo pero no tienen una solución simple o conocida** — hay que investigar fórmulas, permisos o datos.

**Ejemplos que son MEDIA (tomados del histórico):**
- "Alumna no aparece en la lista del curso en el ERP."
- "Pide eliminar una inscripción registrada dos veces."
- "Corregir inscripción registrada como BECA en vez de beneficio Member Black."
- "Pide importar al ERP un alumno del Drive para reprogramarlo."
- "Dar permisos a B2B para ver el módulo de seguimiento."
- "En la base no jala el nombre del programa de dos alumnas."
- "Una hoja de Google Sheets con fórmulas que dan resultados incorrectos."
- "Pide habilitar dos intentos de examen a un alumno."

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
- no suma bien
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
- se desconfiguro
- datos duplicados
- importar datos
- exportar a excel
- no jala
- no jala correctamente
- jala mal
- no aparece en la lista
- no esta en la lista
- no sale en la lista
- alumno no aparece
- alumna no aparece
- no figura en el erp
- corregir inscripcion
- corregir el registro
- corregir los datos del alumno
- actualizar datos de alumno
- cambiar el correo del alumno
- eliminar inscripcion
- inscripcion duplicada
- registrada dos veces
- registro duplicado
- codigo duplicado
- importar al erp
- importar alumno
- importar notas
- subir notas
- reprogramacion
- reprogramar
- reprogramado
- cambio de curso
- cambio de modalidad
- dar acceso
- dar permisos
- crear usuario
- usuarios y permisos
- cuenta corporativa
- correo corporativo
- base de datos
- base de members
- base de asesoras
- base semanal
- base mensual
- lista de asistencias
- match de pagos
- match de asistencia
- kit docente
- intentos de examen
- encuesta
- looker
- dashboard
- fecha incorrecta
- fecha de inicio incorrecta
- aparece con fecha de ayer
- soporte de equipos
- laptop
- espacio en disco
- no inicia sesion

## BAJA

Equivale a **P4**. Tres casos:

1. **Consultas de uso o de dónde está algo**, que se resuelven con una respuesta: dudas sobre qué significa un color, dónde se registra algo, cómo se genera un documento.
2. **Mejoras, quejas de flujo o implementaciones sobre el ERP** que no son fallas — agregar un campo o una opción a un formulario, mejorar cómo se muestra la información, feedback de diseño. No afectan la venta ni la operación actual, solo la mejoran a futuro.
3. **Problemas menores de escritorio o de equipos con solución simple y ya conocida** — Excel de escritorio que no abre y se resuelve reinstalando, configurar una impresora o un calendario. Molestias puntuales, sin efecto en el negocio.

**Ejemplos que son BAJA (tomados del histórico):**
- "Consulta qué significa el color resaltado de un alumno en la lista."
- "Pregunta dónde está el manual del ERP hecho para Fundación."
- "Mostrar 'AGO' en vez de 'agosto' en el dashboard."
- "Pide que todos los campos obligatorios tengan contorno rojo en el formulario de curso."
- "Pide feedback/revisión de las versiones de diseño de la página de sesiones."
- "Configurar su iPhone con el Google Calendar de la empresa."
- "El Excel de escritorio no abre" (cuando la causa es conocida y la solución es reinstalar).

### Palabras clave

- consulta si
- consulta como
- consulta quien
- consulta que
- consulta por
- consulta sobre
- consulta cuando
- pregunta si
- pregunta como
- pregunta donde
- pregunta por
- quiero saber
- queria saber
- me puedes decir
- una duda
- tengo una duda
- donde se ve
- donde se registra
- donde esta
- donde encuentro
- donde ver
- donde colocar
- no encuentro
- como se hace
- como se genera
- como se envia
- como se realiza
- como puedo
- como es el proceso
- para que sirve
- para que existe
- de que base
- quien hizo
- que hacer si
- que significa
- es posible
- se puede
- manual del erp
- capacitacion
- historial de cambios
- pide el link
- por captura
- captura de como
- para ppt
- agregar un campo
- agregar una opcion
- agregar un boton
- agregar una columna al reporte
- agregar un filtro
- agregar una vista
- agregar vista
- añadir vista
- agregar suma
- poder filtrar
- añadir pregunta
- editar formulario
- dar formato
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
- cambiar el nombre en pantalla
- mostrar en vez de
- renombrar
- se ve mal
- cambio visual
- eliminar participante
- eliminar invitado
- eliminar cuentas
- eliminar registro
- eliminar de la lista
- eliminar del erp
- corregir monto
- modificar monto
- certificados generados
- generar qr
- nombre en pantalla
- poner un correo
- desplegable
- codigo de verificacion
- reactivar
- incrustar
- poco adecuado
- sugerencia de mejora
- propuesta de mejora
- solicitud de mejora
- propuesta de diseño
- revisar el diseño
- feedback
- feedback de diseño
- cambios de diseño
- versiones de diseño
- campos obligatorios
- compartir correo
- actualizar firma
- notificacion
- proyector
- musica
- no es urgente
- cuando puedan
- sin apuro
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
- configurar el celular
- google calendar
- el proyector
- cambiar de contraseña de windows
- licencia de office

## Tipo y categoría (referencia, no clasifican)

El cuadro de Sistemas WE también etiqueta cada ticket con un **tipo** y una **categoría**. El clasificador no los usa — sirven para reportería y para decidir a quién se deriva — pero ayudan a entender por qué un ticket cae donde cae.

| Tipo | Cuándo se usa |
| --- | --- |
| Incidente | Algo que funcionaba dejó de funcionar o da un dato incorrecto. |
| Solicitud | Pedido de un entregable o cambio: base, reporte, acceso, configuración. |
| Consulta | Duda de uso o de dónde está algo; se resuelve con una respuesta. |
| Queja de flujo | El proceso funciona pero es engorroso, lento o interrumpe; alimenta mejoras. |

| Categoría | Qué incluye |
| --- | --- |
| Error en Datos | Datos incorrectos, faltantes o que no jalan entre sistemas. |
| Base de Datos | Crear, importar, depurar o entregar bases. |
| Documentos | Reportes, certificados, credenciales y archivos generados. |
| Visualización | Dashboards, Looker y pantallas. |
| Configuración | Parámetros, formularios, correos automáticos y bots. |
| Accesos | Usuarios, permisos y cuentas corporativas. |
| Revisión | Validar flujos, fórmulas, diseños o ediciones. |
| Contenido | PPT, video, news y material. |
| Soporte | Uso del sistema, equipos e infraestructura. |

Como regla práctica: una **Consulta** casi siempre es BAJA; una **Queja de flujo** es BAJA salvo que describa una falla; un **Incidente** sobre dinero, ventas o el sistema caído es ALTA; y una **Solicitud** operativa sobre un alumno o un curso es MEDIA.

Ojo con la palabra **consulta**: en el vocabulario comercial de la casa una "consulta" también es un lead ("Esp. Python: 191 consultas entre asesores"). Por eso no es palabra clave por sí sola — solo cuentan las formas en que abre una pregunta (`consulta si`, `consulta como`, `consulta quien`).
fice
