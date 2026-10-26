// Fragmentos SQL sobre classroom_student_grades que comparten el aula (edition)
// y Seguimiento al Alumno (academica-seguimiento).

// "Tiene nota" = alguien cargo ALGO del alumno: un test (un 0 escrito cuenta),
// una participacion, un criterio del parcial o del final. Misma regla que
// hasAnyGrade del aula (AulaDetail): el panel del lider ignoraba tests y
// participacion y mostraba menos alumnos con nota que el aula.
const anyNumber = (col) => `EXISTS (SELECT 1 FROM jsonb_each(COALESCE(${col}, '{}'::jsonb)) x WHERE jsonb_typeof(x.value) = 'number')`
export const hasAnyGradeSql = (g) => `(${anyNumber(`${g}.tests`)}
      OR EXISTS (SELECT 1 FROM jsonb_each(COALESCE(${g}.participation, '{}'::jsonb)) x WHERE x.value = 'true'::jsonb)
      OR ${anyNumber(`${g}.partial_criteria`)}
      OR ${anyNumber(`${g}.final_criteria`)})`
