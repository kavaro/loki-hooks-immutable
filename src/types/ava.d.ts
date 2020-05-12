// fix bug in ava, should be resolved when v3 is released
declare interface SymbolConstructor {
  readonly observable: symbol;
}