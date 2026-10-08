# ADR-0021: Prints are sold on the site, paid through Stripe and made by Artelo

- Status: Accepted
- Date: 2026-10-08
- Authors: George Vlachos

## Context

George wants visitors to be able to order physical prints of his photographs, with a reasonable margin for him, alongside the gallery and the private full-resolution downloads of ADR-0020. Artelo prints in the US, ships worldwide duties paid, and has an API with price checks, order creation and shipping webhooks. Delivery is the volatile part of the cost: about US$27 for an unframed A3 to Australia, far less within the US and more for framed prints, so a single all-inclusive price per size would either overcharge some countries or lose money on others.

## Decision

- A visitor chooses a size and a frame on a photograph's page and adds the print to a basket; a basket holds up to 10 prints from any photographs. In the basket they enter their delivery address, see one exact delivered total and pay for the whole basket on Stripe's hosted checkout page, where that address is shown and can't be changed. When Stripe confirms payment, the site places one Artelo order with every print, giving Artelo a short-lived photo-scoped download link for each print file.
- Prints have a fixed price list in AUD, one price per size and frame, set from Artelo's production cost plus George's margin after card fees and rounded to friendly numbers. The margin lives entirely in this price.
- Delivery is charged separately at Artelo's exact quote for the buyer's address: the site asks Artelo's Price Check for the whole basket and that address, and adds a small buffer for exchange-rate movement (8%, a setting George can change without a deploy). George neither profits nor loses on freight, and the margin is the same everywhere. Any tax Artelo's Price Check adds for the address (US sales tax, Canadian GST, HST, PST or any other tax) is passed on in the same line, labelled "delivery and destination taxes", with the buffer applied to freight and tax together. The address is collected on the site before payment, held only in the request and on the Stripe payment and passed to Artelo; the site never stores it. Prints ship worldwide.
- George sells as himself and isn't registered for GST, so prices carry no GST. The disclosure is one plain sentence, "prices include no gst; the seller isn't registered for gst", on the photograph's page, the basket, Stripe's checkout page (its custom text), Stripe's free receipt (the payment description) and the order page. There is no invoice. The seller name and GST setting are configuration, so registering later changes no code.

Amended 2026-10-08 at George's direction, after the design review:

- **Several prints in one order.** A buyer can put up to 10 prints in a basket and pay once, with Artelo's exact combined delivery for their address as above, one Stripe Checkout session holding every print plus one delivery line, and one Artelo order with every print, each made from its full-resolution master.
- **The basket lives in the URL's query string**, not in cookies, localStorage or sessionStorage, so the visitor info's "cookies none" and the privacy test's empty storage stay true. The trade-off accepted: the basket is visible and editable in the address bar, so the server re-validates every item, tier and price at checkout and trusts nothing from the query string. In return, a basket can be bookmarked or shared.
- **No paid invoice.** The "no GST" disclosure is the plain sentence above, wherever a buyer sees a price.
- **Address first.** Delivery is quoted against the buyer's own address before payment, so the total they pay is exact. The quoted address is fixed on Stripe's page; changing it means quoting again on the site, so freight never changes silently.

## Consequences

Orders need no manual work, and a buyer anywhere sees one delivered total for their whole basket before paying. The site takes on a payment webhook, an order store and failure handling: if Artelo refuses an order after payment, the site retries and flags it in `/admin` for George to resolve or refund. Stripe's checkout page is Stripe's own domain and sets its own cookies, so the visitor info's "cookies none" stays true of the site and the checkout step says where it happens. The fixed prices need a review when Artelo's costs or the exchange rate move a lot, and a check script compares them with Artelo's current costs. Stripe, Artelo and their webhook secrets are Worker secrets George sets.

## Alternatives considered

- **A Shopify store connected to Artelo:** least custom code, but a monthly fee and visitors leave the site to buy.
- **A request form, with George placing each order by hand:** no payment code, but manual work and invoicing for every print.
- **Live cost plus a percentage:** always tracks Artelo, but prices become odd numbers that change over time.
- **One all-inclusive price per size, worldwide:** simple, but freight differences would make the margin swing by country, negative on some framed prints.
- **A cart kept in a cookie, localStorage or sessionStorage:** the usual way to hold a basket, but it would break the site's "cookies none" promise and its empty-storage guarantee.
- **A formal Stripe invoice carrying the GST statement:** a proper document, but Stripe's Invoicing fee costs about 0.4% of every order just to carry one sentence, and a seller who isn't registered for GST has no duty to issue one.
- **Summed per-print delivery** (each size and frame's freight to the country, added up): needs no address before payment, but overcharges mixed baskets, because Artelo sends prints together for less.
- **Country-only quotes:** a lighter form, but Artelo's combined price for an order needs a full address, so a country alone can't give an exact total.
