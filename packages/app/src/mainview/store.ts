/**
 * Thin facade over the domain stores (see `./stores`). Kept at this path so
 * existing consumers (`useStore`, `StoreKey`, `Store`, domain types) keep
 * importing from `../store` unchanged while the concrete logic lives in
 * `stores/`.
 */
export * from "./stores"
