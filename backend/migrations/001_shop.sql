CREATE TABLE shops (
 slug text PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL,
 origin text NOT NULL, free_m integer NOT NULL DEFAULT 3000 CHECK(free_m >= 0),
 per_km integer NOT NULL DEFAULT 10000 CHECK(per_km >= 0),
 bank text NOT NULL DEFAULT '', account text NOT NULL DEFAULT '',
 webhook_env text NOT NULL DEFAULT ''
);
CREATE TABLE items (
 id text PRIMARY KEY, shop text NOT NULL REFERENCES shops, name text NOT NULL, description text NOT NULL,
 price integer NOT NULL CHECK(price BETWEEN 0 AND 10000000),
 stock integer NOT NULL CHECK(stock>=0), toppings jsonb NOT NULL, photo text NOT NULL DEFAULT ''
);
CREATE INDEX items_shop ON items(shop);
CREATE TABLE quotes (
 id text PRIMARY KEY, shop text NOT NULL REFERENCES shops, buyer text NOT NULL,
 address text NOT NULL, meters integer NOT NULL, fee integer NOT NULL, created timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE orders (
 id text PRIMARY KEY, shop text NOT NULL REFERENCES shops, buyer text NOT NULL, request_id text NOT NULL,
 state text NOT NULL DEFAULT 'pending', method text NOT NULL, paid boolean NOT NULL DEFAULT false,
 phone text NOT NULL, address text NOT NULL, note text NOT NULL, lines jsonb NOT NULL,
 fee integer NOT NULL, total bigint NOT NULL, bank text NOT NULL, account text NOT NULL,
 created timestamptz NOT NULL DEFAULT now(), expires timestamptz, UNIQUE(buyer,request_id)
);
CREATE INDEX order_shop ON orders(shop,created DESC);
CREATE INDEX order_buyer ON orders(buyer,created DESC);
CREATE TABLE messages (
 id bigserial PRIMARY KEY, order_id text NOT NULL REFERENCES orders, author text NOT NULL, body text NOT NULL,
 created timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_order ON messages(order_id,id);
CREATE TABLE reviews (
 order_id text NOT NULL REFERENCES orders, item text NOT NULL REFERENCES items, stars integer NOT NULL CHECK(stars BETWEEN 1 AND 5),
 body text NOT NULL, PRIMARY KEY(order_id,item)
);
CREATE TABLE transfers (
 shop text NOT NULL REFERENCES shops, external_id text NOT NULL, code text NOT NULL, amount bigint NOT NULL,
 matched boolean NOT NULL DEFAULT false, received timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(shop,external_id)
);
CREATE TABLE subscriptions (shop text NOT NULL REFERENCES shops, device text NOT NULL, PRIMARY KEY(shop,device));
CREATE TABLE push_jobs (order_id text PRIMARY KEY REFERENCES orders, attempts integer NOT NULL DEFAULT 0, next_try timestamptz NOT NULL DEFAULT now());
