// Simulate an upstream API change: two response-field renames plus one
// request-field rename in the helpdesk ticket schemas.
import fs from 'node:fs'
const f = process.argv[2]
const src = fs.readFileSync(f, 'utf8')
const indent = (src.split('\n')[1].match(/^\s*/) || [''])[0].length || 2
const s = JSON.parse(src)
function rename(schema, from, to) {
    const sch = s.components.schemas[schema]
    if (!sch?.properties?.[from]) throw new Error(`${schema}.${from} missing`)
    const props = {}
    for (const [k, v] of Object.entries(sch.properties)) props[k === from ? to : k] = v
    sch.properties = props
    if (sch.required) sch.required = sch.required.map((r) => (r === from ? to : r))
}
rename('Ticket', 'statusCategory', 'statusGroup')
rename('TicketListItem', 'statusCategory', 'statusGroup')
rename('CreateTicketMessageBody', 'content', 'text')
fs.writeFileSync(f, JSON.stringify(s, null, indent) + '\n')
