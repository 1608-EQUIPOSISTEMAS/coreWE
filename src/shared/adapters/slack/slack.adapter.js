import slackClient from '../../../config/slack.js'

// Adapter del SlackPort sobre el cliente Slack legacy. Expone solo las
// operaciones que consume el dominio. Permite sustituir el proveedor (o
// silenciarlo en tests) sin tocar los usecases.
export function createSlackAdapter (client = slackClient) {
  return {
    notifyTokenCreated: payload => client.notifyTokenCreated(payload),
    notifyTokenLinkAdded: payload => client.notifyTokenLinkAdded(payload),
    notifyInstructorCredentials: payload => client.notifyInstructorCredentials(payload)
  }
}

export const slack = createSlackAdapter()
