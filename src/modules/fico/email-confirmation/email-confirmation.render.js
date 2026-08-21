import { buildConfirmacionHTML } from '../../../templates/confirmacion-inscripcion.js'
import { buildConfirmacionOnlineHTML } from '../../../templates/confirmacion-online.js'
import { buildConfirmacionEventoHTML } from '../../../templates/confirmacion-evento.js'
import { isSinglePayment } from './email-confirmation.entity.js'

// Unico punto donde se decide QUE plantilla de confirmacion se renderiza.
//
// Antes esta decision vivia duplicada en previewConfirmationEmail y
// sendConfirmationEmail: dos ternarios identicos que habia que mantener a la
// par. Con tres plantillas la duplicacion garantizaba que el preview terminara
// mintiendo respecto de lo que se envia.
//
// La rama de membresia NO pasa por aqui: sale antes con un early return en el
// usecase, porque tiene su propio flujo de datos y su propio remitente.

const EVENT_PROGRAM_TYPE_ALIAS = 'we_program_type_event'
const VIRTUAL_TICKET_ALIAS = 'we_event_category_virtual'
const VIP_TICKET_ALIAS = 'we_event_category_vip'

// Un enrollment es de evento si tiene categoria de entrada asignada O si el
// tipo de programa es evento.
//
// Se aceptan las dos senales a proposito: cat_event_category existe con
// certeza (lo creo add-event-category.sql) mientras que la fila
// 'we_program_type_event' del catalogo puede no estar dada de alta todavia. Si
// no existe, la comparacion simplemente no matchea y no rompe nada.
export function resolveConfirmationTemplate (data = {}) {
  const isEvent = data.cat_event_category != null ||
                  data.program_type_alias === EVENT_PROGRAM_TYPE_ALIAS
  const isVirtualTicket = data.event_category_alias === VIRTUAL_TICKET_ALIAS
  return { isEvent, isVirtualTicket }
}

// Asunto del correo de confirmacion. Vive aca y no en el usecase porque estaba
// duplicado en preview y send: dos plantillas literales identicas que se
// desincronizaban. En eventos lleva la modalidad (VIP / GENERAL / VIRTUAL): es
// lo primero que el asistente necesita distinguir en su bandeja.
export function buildConfirmationSubject (data = {}) {
  const base = `Confirmacion de Inscripcion - ${data.program_name || 'WE Educacion'}`
  const { isEvent } = resolveConfirmationTemplate(data)
  const category = String(data.event_category_label || '').trim().toUpperCase()
  return (isEvent && category) ? `${base} - ENTRADA ${category}` : base
}

// Detalle de sesiones segun la entrada, con fallback cruzado: si la edicion
// solo cargo uno de los dos textos, se usa ese. Mejor un detalle aproximado que
// un correo sin ninguna indicacion de cuando y donde es el evento.
function resolveSessionDetail (data, isVirtualTicket) {
  const preferred = isVirtualTicket ? data.session_detail_virtual : data.session_detail_onsite
  const fallback = isVirtualTicket ? data.session_detail_onsite : data.session_detail_virtual
  return (preferred || '').trim() || (fallback || '').trim() || ''
}

// Devuelve { html, kind }. `kind` sirve para que el llamador decida cosas que
// dependen de la plantilla (por ejemplo: un evento no lleva PDF de cronograma).
export function renderConfirmationEmail ({
  data,
  firstName,
  lastName,
  odooEmail,
  isNew,
  frequency,
  schedule,
  instRows,
  sapCredentials,
  isOnline,
  isParentProgram,
  // Banner ya resuelto por el usecase: 'cid:...' al enviar, 'data:...' en el
  // preview. Si no viene, se cae al link por URL.
  bannerUrl = null
}) {
  const studentName = `${firstName} ${lastName}`
  const { isEvent, isVirtualTicket } = resolveConfirmationTemplate(data)

  // Precedencia: evento gana sobre online. Un congreso VIRTUAL no debe caer en
  // la plantilla online/SAP, que habla de campus y credenciales.
  if (isEvent) {
    return {
      kind: 'evento',
      html: buildConfirmacionEventoHTML({
        studentName,
        eventName: data.program_name,
        categoryLabel: data.event_category_label || '',
        sessionDetail: resolveSessionDetail(data, isVirtualTicket),
        bannerUrl: bannerUrl || data.banner_link || '',
        // El asiento asignado es propio de la entrada VIP. Se filtra aca y no
        // en la plantilla para que un cambio de categoria (VIP -> GENERAL) deje
        // de mostrarlo sin tener que borrar el dato.
        seat: data.event_category_alias === VIP_TICKET_ALIAS ? data.event_seat : null,
        // Cada categoria tiene su propio grupo (los VIP no van al de los
        // VIRTUAL). El de la edicion queda como red: eventos configurados
        // antes de que existiera el link por categoria siguen funcionando.
        whatsappLink: data.event_whatsapp_link || data.whatsapp_link || '',
        certificateFormLink: data.certificate_form_link || '',
        businessCardLink: data.business_card_link || '',
        // Mismo criterio que la plantilla de curso: al contado no hay nada que
        // programar, con cuotas el asistente necesita ver cuando y cuanto paga.
        installments: isSinglePayment(data.payment_plan_alias) ? [] : instRows,
        currencySymbol: data.currency_symbol || 'S/.'
      })
    }
  }

  if (isOnline) {
    return {
      kind: 'online',
      html: buildConfirmacionOnlineHTML({
        studentName,
        programName: data.program_name,
        email: odooEmail,
        isNew,
        sapUser: sapCredentials?.sap_username || null,
        sapPassword: sapCredentials?.sap_password || null
      })
    }
  }

  return {
    kind: 'curso',
    html: buildConfirmacionHTML({
      studentName,
      programName: data.program_name,
      startDate: data.start_date,
      frequency,
      schedule,
      whatsappLink: data.whatsapp_link || '',
      email: odooEmail,
      isNew,
      bannerUrl: data.banner_link || '',
      installments: isSinglePayment(data.payment_plan_alias) ? [] : instRows,
      currencySymbol: data.currency_symbol || 'S/.',
      hideWhatsapp: isParentProgram
    })
  }
}
