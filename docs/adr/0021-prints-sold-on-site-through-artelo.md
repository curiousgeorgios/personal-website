# ADR-0021: Prints are sold on the site, paid through Stripe and made by Artelo

- Status: Accepted
- Date: 2026-10-08
- Authors: George Vlachos

## Context

George wants visitors to be able to order physical prints of his photographs, with a reasonable margin for him, alongside the gallery and the private full-resolution downloads of ADR-0020. Artelo prints in the US, ships worldwide duties paid, and has an API with price checks, order creation and shipping webhooks. Delivery is the volatile part of the cost: about US$27 for an unframed A3 to Australia, far less within the US and more for framed prints, so a single all-inclusive price per size would either overcharge some countries or lose money on others.

## Decision

- A visitor chooses a size, a frame and their country on the photograph's page and pays on Stripe's hosted checkout page. When Stripe confirms payment, the site places the order with Artelo itself, giving it a short-lived photo-scoped download link for the print file.
- Prints have a fixed price list in AUD, one price per size and frame, set from Artelo's production cost plus George's margin after card fees and rounded to friendly numbers. The margin lives entirely in this price.
- Delivery is charged separately at Artelo's quoted cost for the buyer's country plus a small buffer for exchange-rate movement, so George neither profits nor loses on freight and the margin is the same everywhere. Prints ship worldwide.
- George sells as himself and isn't registered for GST, so prices carry no GST and receipts say so. The seller name and GST setting are configuration, so registering later changes no code.

## Consequences

Orders need no manual work, and a buyer anywhere sees one delivered total before paying. The site takes on a payment webhook, an order store and failure handling: if Artelo refuses an order after payment, the site retries and flags it in `/admin` for George to resolve or refund. Stripe's checkout page is Stripe's own domain and sets its own cookies, so the visitor info's "cookies none" stays true of the site and the checkout step says where it happens. The fixed prices need a review when Artelo's costs or the exchange rate move a lot, and a check script compares them with Artelo's current costs. Stripe, Artelo and their webhook secrets are Worker secrets George sets.

## Alternatives considered

- **A Shopify store connected to Artelo:** least custom code, but a monthly fee and visitors leave the site to buy.
- **A request form, with George placing each order by hand:** no payment code, but manual work and invoicing for every print.
- **Live cost plus a percentage:** always tracks Artelo, but prices become odd numbers that change over time.
- **One all-inclusive price per size, worldwide:** simple, but freight differences would make the margin swing by country, negative on some framed prints.
