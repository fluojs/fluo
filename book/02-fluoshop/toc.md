# Volume 2 Contents - FluoShop: A Successful Blog Opens a Store

[Series introduction](../README.md) | [How to read this volume](./README.md)

## Part 1. Readers Become Customers

1. [Adding a Shop to the Existing Blog](./ch01-grow-the-blog.md)
2. [Separating Content, Catalog, and Order Boundaries](./ch02-domain-boundaries.md)
3. [Modeling a T-shirt as a Product](./ch03-catalog-and-money.md)
4. [Building the Journey from Blog to Purchase](./ch04-storefront.md)

## Part 2. Consistency Across Orders and Inventory

5. [Why You Cannot Trust Cart Prices](./ch05-cart-and-pricing.md)
6. [Designing Orders as a State Machine](./ch06-order-state-machine.md)
7. [What If Two People Buy the Last T-Shirt?](./ch07-inventory-concurrency.md)
8. [Two Clicks on Buy, but Only One Order](./ch08-idempotent-checkout.md)

## Part 3. Working with External Systems That Fail

9. [Keeping the Payment Provider Outside the Application](./ch09-payment-boundary.md)
10. [Handling Payment Webhooks Safely](./ch10-payment-webhooks.md)
11. [Cancellation and Refunds Are Not an Undo Button](./ch11-refunds-and-compensation.md)
12. [Reconciling Interrupted Orders](./ch12-reconciliation.md)

## Part 4. Making Asynchronous Work Reliable

13. [Notifying Other Features That an Order Has Been Paid](./ch13-domain-events.md)
14. [What If the Save Succeeded but the Event Disappeared?](./ch14-outbox-and-inbox.md)
15. [Running Failed Jobs Again](./ch15-reliable-jobs.md)
16. [Write Models and Read Models Develop Different Needs](./ch16-cqrs-projections.md)
17. [Coordinating Multi-Step Order Processing](./ch17-order-sagas.md)

## Part 5. The System Seen by Customers and Operators

18. [Delivering the Same Event through Email, Slack, and Discord](./ch18-notification-channels.md)
19. [Showing Order Status in Real Time](./ch19-realtime-orders.md)
20. [Building a Query API for the Operations Dashboard](./ch20-graphql-dashboard.md)
21. [Cache Products, but Do Not Trust the Cache Alone for Inventory Decisions](./ch21-commerce-caching.md)
22. [Selling to International Readers](./ch22-international-commerce.md)

## Part 6. Extracting Only What You Need and Comparing Alternatives

23. [Extracting Fulfillment into a Separate Service](./ch23-extract-fulfillment.md)
24. [A Lab for Choosing Message Transports](./ch24-transport-lab.md) - comparison lab
25. [Implementing the Same Repository Contract with Prisma and Drizzle](./ch25-drizzle-lab.md) - comparison lab
26. [Building Document Models for Reviews and Products with MongoDB](./ch26-mongoose-lab.md) - comparison lab

## Part 7. When Orders Surge and Failures Strike

27. [Observing a Sale Event and Finding Bottlenecks](./ch27-sale-observability.md)
28. [Completing FluoShop with Failure Drills](./ch28-failure-drills.md)
