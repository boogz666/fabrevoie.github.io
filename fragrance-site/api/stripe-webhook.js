import { createCommerceHandlers } from '../lib/commerce.mjs';

// This handler consumes the raw Node stream; it never accesses request.body.
export default createCommerceHandlers().webhook;
