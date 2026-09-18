// Evolution "webhook by events" appends /messages-upsert (etc.) to the
// configured URL. Reuse the same handler as the un-suffixed route.
export { POST } from '../route';
