import odooClient from '../../../config/odooClient.js'

// Adapter del OdooPort sobre el cliente Odoo legacy. Expone las operaciones que
// consumen los dominios migrados (instructor + FICO), de modo que los usecases
// dependan de este puerto y no del cliente concreto. Mockeable en tests.
export function createOdooAdapter (client = odooClient) {
  return {
    callKw: (...args) => client.callKw(...args),
    syncInstructorToOdoo: payload => client.syncInstructorToOdoo(payload),
    syncStudentToOdoo: payload => client.syncStudentToOdoo(payload),
    syncStudentToOdooOnline: payload => client.syncStudentToOdooOnline(payload),
    searchUserByEmail: (...args) => client.searchUserByEmail(...args),
    searchSlideGroup: (...args) => client.searchSlideGroup(...args),
    searchSlideChannelByName: (...args) => client.searchSlideChannelByName(...args),
    enrollStudentInChannelOnly: (...args) => client.enrollStudentInChannelOnly(...args),
    listOnlineChannels: (...args) => client.listOnlineChannels(...args),
    enrollInAllOnlineCourses: (...args) => client.enrollInAllOnlineCourses(...args),
    createSaleOrderWithFees: (...args) => client.createSaleOrderWithFees(...args),
    activateFees: (...args) => client.activateFees(...args),
    markFeeAsPaid: (...args) => client.markFeeAsPaid(...args),
    updateFeeDueDates: (...args) => client.updateFeeDueDates(...args),
    updateFees: (...args) => client.updateFees(...args),
    findOdooFees: (...args) => client.findOdooFees(...args),
    unenrollStudentFromCourse: (...args) => client.unenrollStudentFromCourse(...args),
    cancelSaleOrder: (...args) => client.cancelSaleOrder(...args),
    updateUserLogin: (...args) => client.updateUserLogin(...args),
    updateStudentInOdoo: (...args) => client.updateStudentInOdoo(...args)
  }
}

export const odoo = createOdooAdapter()
