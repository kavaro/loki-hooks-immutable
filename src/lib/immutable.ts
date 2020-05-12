import { HookMethods, TObj, TCreate } from 'member-hooks'

export interface TPatch {
  op: "replace" | "remove" | "add",
  path: Array<string | number>,
  value?: any
}

export type TPatchesCallback = (patches: TPatch[], reversePatches: TPatch[]) => void

export interface TImmer {
  isDraft: (value: any) => boolean
  createDraft: (value: any) => any
  finishDraft: (value: any, fn?: TPatchesCallback) => any
  enablePatches: () => void
}

export interface TImmutableOptions {
  priority?: number
  immer?: TImmer
  patches?: boolean
  production?: boolean
  insertEvent?: string
  updateEvent?: string
  removeEvent?: string
}

export interface TPatchReversePatch {
  patches?: TPatch[]
  reversePatches?: TPatch[]
}

export interface TCollectionChange extends CollectionChange {
  patches?: TPatch[]
  reversePatches?: TPatch[]
}

const { isArray } = Array

/**
 * Hook factory function that freezes documents of a collection when the production options is false.
 * When an immer draft is passed as doc to the insert/update methods, then finishDraft is called on the draft before the
 * insert/update is performed.
 * When immer and patch are enabled, then patches are generated with finishDraft.
 * The patches are available via the second argument on the insertEvent and updateEvent listeners.
 * The insertEvent/updateEvent/deleteEvent call the listener with the immutable doc as the first argument
 * To enable insertEvent/updateEvent/deleteEvent events, their respective options must be set to the name of the event.
 * When the length of the name of the event is 0 then the event is suppressed. 
 * @param methods 
 * @param options 
 */
export function immutable(methods: HookMethods, options: TImmutableOptions): TCreate {
  const { priority, immer, patches, production, insertEvent, updateEvent, deleteEvent } = {
    priority: -1000000,
    immer: null,
    patches: false,
    production: false,
    insertEvent: '',
    updateEvent: '',
    deleteEvent: '',
    ...options
  }

  function unfreezeDoc(doc: any, context: TPatchReversePatch[]): any {
    if (immer) {
      if (!immer.isDraft(doc)) {
        doc = Object.assign(immer.createDraft({}), doc)
      }
      doc = patches
        ? immer.finishDraft(doc, (docPatches, reverseDocPatches) => context.push({ patches: docPatches, reversePatches: reverseDocPatches }))
        : immer.finishDraft(doc)
    }
    if (doc && Object.isFrozen(doc)) {
      doc = { ...doc }
    }
    if (doc.meta && Object.isFrozen(doc.meta)) {
      doc.meta = { ...doc.meta }
    }
    return doc
  }

  function unfreezeInsert(args: any[]): TPatchReversePatch | TPatchReversePatch[] {
    const context: TPatchReversePatch[] = []
    const doc = args[0]
    if (isArray(doc)) {
      args[0] = doc.map(obj => unfreezeDoc(obj, context))
      return context
    }
    args[0] = unfreezeDoc(doc, context)
    return context[0]
  }

  function unfreezeUpdate(args: any[]): TPatchReversePatch | void {
    const context: TPatchReversePatch[] = []
    const doc = args[0]
    if (!isArray(doc)) {
      args[0] = unfreezeDoc(doc, context)
      return context[0]
    }
  }

  function deepFreeze(obj: TObj<any>): TObj<any> {
    if (!production) {
      Object.freeze(obj)
      Object.getOwnPropertyNames(obj).forEach(function (prop: string): void {
        if (obj.hasOwnProperty(prop) && obj[prop] !== null && (typeof obj[prop] === "object") && !Object.isFrozen(obj[prop])) {
          deepFreeze(obj[prop])
        }
      })
    }
    return obj
  }

  function deepFreezeInsert(this: Collection<any>, doc: any, _: any[], contextPatches: any): any {
    if (isArray(doc)) {
      doc = doc.map(obj => deepFreeze(obj))
      insertEvent && this.emit(insertEvent, doc, contextPatches)
    } else {
      doc = deepFreeze(doc)
      insertEvent && this.emit(insertEvent, doc, contextPatches)
    }
    return doc
  }

  function deepFreezeUpdate(this: Collection<any>, doc: any, _: any[], contextPatches: any): any {
    if (doc) {
      doc = deepFreeze(doc)
      updateEvent && this.emit(updateEvent, doc, contextPatches)
    }
    return doc
  }

  function deepFreezeRemove(this: Collection<any>, doc: any, _: any[]): any {
    if (doc) {
      doc = deepFreeze(doc)
    }
    return doc
  }

  function unfreezeRemoveDoc(this: Collection<any>, doc: any): any {
    const $loki = typeof doc === 'number' ? doc : doc.$loki
    const arr = this.get($loki, true)
    if (arr) {
      const [obj, index] = arr
      this.data[index] = { ...obj }
    }
  }

  function unfreezeRemove(this: Collection<any>, args: any[]): void {
    const doc = args[0]
    if (isArray(doc)) {
      doc.forEach(obj => unfreezeRemoveDoc.call(this, obj))
    } else {
      unfreezeRemoveDoc.call(this, doc)
    }
  }

  methods.before('insert', priority, unfreezeInsert)
  methods.after('insert', priority, deepFreezeInsert)
  methods.before('update', priority, unfreezeUpdate)
  methods.after('update', priority, deepFreezeUpdate)
  methods.before('remove', priority, unfreezeRemove)
  methods.after('remove', priority, deepFreezeRemove)

  return (collection: Collection<any>) => {
    if (immer && patches) {
      immer.enablePatches()
    }
    const { events } = collection
    const eventNames = [insertEvent, updateEvent, deleteEvent]
    eventNames.forEach(eventName => {
      if (eventName && !events[eventName]) {
        events[eventName] = []
      }
    })
    const deleted = (doc: any) => deleteEvent && collection.emit(deleteEvent, deepFreeze({ ...doc }))
    collection.addListener('delete', deleted)
    if (!production) {
      collection.data.forEach(deepFreeze)
    }
    return () => {
      collection.removeListener('delete', deleted)
    }
  }
}