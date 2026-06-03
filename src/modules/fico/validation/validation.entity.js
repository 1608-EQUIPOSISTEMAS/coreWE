// Reglas puras del subdominio de convalidaciones y estructura padre-hijo
// (diplomados / ESP / PEE). Sin acceso a BD, Odoo, correo ni reloj oculto:
// todo entra por parametros y se decide sobre datos ya cargados en memoria.
// Esto las hace testeables sin levantar infraestructura.

// Tipo de validacion que NO convalida un modulo, sino que solo fuerza una
// edicion concreta para el. Un hijo con este tipo se inscribe igual (no se
// salta), pero aportando su custom_edition_id al plan.
export const EDITION_OVERRIDE = 'edition_override'

// A partir de las filas crudas de enrollment_validations construye los indices
// que el resto del flujo consume: el conjunto de hijos efectivamente convalidados
// (que se saltan al inscribir) y el mapa de ediciones forzadas por hijo.
// edition_override NO convalida: aporta custom_edition_id pero el hijo se inscribe.
export function buildValidationContext (validationRows = []) {
  const validatedSet = new Set(
    validationRows
      .filter(v => v.validation_type !== EDITION_OVERRIDE)
      .map(v => v.child_version_id)
  )
  const customEditions = {}
  validationRows
    .filter(v => v.custom_edition_id)
    .forEach(v => { customEditions[v.child_version_id] = v.custom_edition_id })

  return { validatedSet, customEditions }
}

// Convierte los hijos del arbol del padre (salida de sp_edition_tree_get) en un
// mapa child_program_version_id -> datos de edicion. La edicion puede venir como
// edition_id o edition_num_id segun el SP; se normaliza a editionId.
export function buildEditionMap (treeChildren = []) {
  const editionMap = {}
  for (const ch of treeChildren) {
    if (ch.child_program_version_id && (ch.edition_id || ch.edition_num_id)) {
      editionMap[ch.child_program_version_id] = {
        editionId: ch.edition_id || ch.edition_num_id,
        globalCode: ch.global_code || '',
        startDate: ch.start_date || '',
        sortOrder: ch.sort_order || 0
      }
    }
  }
  return editionMap
}

// Detecta hijos que no pueden inscribirse: no convalidados, sin edicion en el
// arbol del padre y sin edicion custom. El operador debe convalidarlos o elegir
// una edicion antes de confirmar. Devuelve la lista de bloqueos (vacia = ok).
export function findUnassignableChildren ({ childrenStruct, validatedSet, editionMap, customEditions }) {
  const errors = []
  for (const ch of childrenStruct) {
    const childPvId = ch.child_program_version_id
    if (validatedSet.has(childPvId)) continue
    const inTree = !!editionMap[childPvId]
    const hasCustom = !!customEditions[childPvId]
    if (!inTree && !hasCustom) {
      errors.push({
        child_program_version_id: childPvId,
        child_name: ch.child_name,
        message: `El modulo "${ch.child_name}" no tiene edicion programada en este diplomado. Debes convalidarlo o elegir una edicion especifica.`
      })
    }
  }
  return errors
}

// Construye el plan de inscripcion de hijos SEG y decide el escenario E0.
//
// Para cada hijo NO convalidado define su edicion final con la regla de
// precedencia: custom_edition_id gana sobre la edicion del arbol del padre. Un
// hijo sin ninguna de las dos se reporta en `skipped` (se saltara). Un hijo cuya
// edicion final no proviene del arbol esta "fuera del arbol": si al menos uno lo
// esta, el escenario es E0 (el padre se desinscribe y los hijos van individuales).
//
// No ejecuta efectos: solo devuelve el plan, los saltos y el flag isE0 para que
// el usecase persista y dispare Odoo/email segun corresponda.
export function buildEditionPlan ({ childrenStruct, validatedSet, editionMap, customEditions }) {
  const editionPlan = []
  const skipped = []
  let anyOutsideTree = false

  for (const ch of childrenStruct) {
    const childPvId = ch.child_program_version_id
    if (validatedSet.has(childPvId)) continue

    const treeEdition = editionMap[childPvId]
    const customEdId = customEditions[childPvId]
    const isOutsideTree = !treeEdition
    if (isOutsideTree) anyOutsideTree = true

    const editionId = customEdId || treeEdition?.editionId
    if (!editionId) {
      skipped.push({ childPvId, childName: ch.child_name })
      continue
    }

    editionPlan.push({
      childPvId,
      childName: ch.child_name,
      editionId,
      isOutsideTree,
      globalCode: treeEdition?.globalCode || `(custom-${editionId})`,
      sortOrder: ch.sort_order ?? treeEdition?.sortOrder ?? 0
    })
  }

  // E0 solo aplica si efectivamente se inscribira algun hijo fuera del arbol.
  const isE0 = anyOutsideTree && editionPlan.length > 0
  return { editionPlan, skipped, isE0 }
}

// Mapea los hijos del arbol del padre a su edicion default (tree edition).
// Usado por getProgramChildren para anotar cada hijo con la edicion que el arbol
// del padre le asigna; null = el hijo no esta programado en esa edicion.
export function buildTreeEditionMap (treeChildren = []) {
  const treeMap = {}
  for (const ch of treeChildren) {
    if (ch.child_program_version_id) {
      treeMap[ch.child_program_version_id] = ch.edition_id || ch.edition_num_id || null
    }
  }
  return treeMap
}

// Anota cada hijo del programa con la edicion default del arbol del padre y si
// esta programado en el. Conserva el resto de campos de la fila intactos.
export function annotateChildrenWithTree (childrenRows, treeMap) {
  return childrenRows.map(r => ({
    ...r,
    tree_edition_id: treeMap[r.child_program_version_id] || null,
    is_in_parent_tree: !!treeMap[r.child_program_version_id]
  }))
}
