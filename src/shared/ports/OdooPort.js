// Contrato del puerto de integracion con Odoo. La implementacion concreta vive
// en shared/adapters/odoo. Se ira ampliando a medida que migren los dominios que
// hoy llaman a odooClient directo (FICO, comercial). Por ahora cubre instructor.
//
// @typedef {Object} OdooPort
// @property {(p: {login, name, password, linkedin, internalNotes, parentId}) => Promise<{odoo_user_id, odoo_partner_id, odoo_error}>} syncInstructorToOdoo

export {}
