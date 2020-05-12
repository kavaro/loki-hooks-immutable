import test from 'ava'
import sinon from 'sinon'
import { Hooks } from 'member-hooks'
import Loki from 'lokijs'
import { v4 as uuid } from 'uuid'
import produce, * as immer from 'immer'
import { createHooksLoki } from 'loki-hooks'
import { immutable } from './immutable'

const { isArray } = Array

const dbHooks = new Hooks()
const collectionHooks = new Hooks()
collectionHooks.register('immutable', immutable)

const HooksLoki = createHooksLoki(dbHooks, collectionHooks)

async function save(db: Loki): Promise<void> {
  return new Promise((resolve, reject) => {
    db.saveDatabase((err: any) => {
      err ? reject(err) : resolve()
    })
  })
}

async function load(db: Loki): Promise<void> {
  return new Promise((resolve, reject) => {
    db.loadDatabase({}, (err: any) => {
      err ? reject(err) : resolve()
    })
  })
}

function withoutMeta(doc: any): any {
  if (isArray(doc)) {
    return doc.map(withoutMeta)
  }
  if (doc.meta) {
    const { meta, ...fields } = doc
    return fields
  }
  return doc
}

test('should not freeze document after insert/update/remove when production is true', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const collection = db.addCollection('collection', {
    hooks: {
      config: [['immutable', { production: true }]]
    }
  })
  const inserted = collection.insert({ id: 'id1' })
  t.assert(!Object.isFrozen(inserted))
  const updated = collection.update(produce(inserted, (draft: any) => { draft.name = 'name1' }))
  t.assert(!Object.isFrozen(updated))
  const deleted = collection.remove(updated.$loki)
  t.assert(!Object.isFrozen(deleted))
  t.throws(() => collection.remove(120)) // remove doc that does not exist
  db.removeCollection('collection')
})

test('should freeze document after insert/update/remove', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const collection = db.addCollection('collection', {
    hooks: {
      config: [['immutable', {}]]
    }
  })
  const inserted = collection.insert({ id: 'id1' })
  t.assert(Object.isFrozen(inserted))
  const updated = collection.update(produce(inserted, (draft: any) => { draft.name = 'name1' }))
  t.assert(Object.isFrozen(updated))
  const deleted = collection.remove(updated.$loki)
  t.assert(Object.isFrozen(deleted))
  db.removeCollection('collection')
})

test('should freeze documents after load', async t => {
  const db1 = new HooksLoki('load-test.db.json', {
    adapter: new Loki.LokiFsAdapter()
  })
  const collection1 = db1.addCollection('collection', {
    disableMeta: true,
    hooks: {
      config: [['immutable', {}]]
    }
  })
  collection1.insert([{ id: 'id1' }, { id: 'id2' }])
  await save(db1)
  const db2 = new HooksLoki('load-test.db.json', {
    adapter: new Loki.LokiFsAdapter()
  })
  await load(db2)
  const collection2 = db2.getCollection('collection')
  const docs = collection2.find()
  t.deepEqual(docs, [{ $loki: 1, id: 'id1' }, { $loki: 2, id: 'id2' }])
  t.assert(Object.isFrozen(docs[0]))
  t.assert(Object.isFrozen(docs[1]))
})

test('should emit events without patches after insert/update/remove', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const collection = db.addCollection('collection', {
    hooks: {
      config: [['immutable', {
        insertEvent: 'inserted', updateEvent: 'updated', deleteEvent: 'deleted',
        immer
      }]]
    }
  })
  const insertedSpy = sinon.spy()
  collection.addListener('inserted', insertedSpy)
  const updatedSpy = sinon.spy()
  collection.addListener('updated', updatedSpy)
  const deletedSpy = sinon.spy()
  collection.addListener('deleted', deletedSpy)
  const inserted = collection.insert({ id: 'id1' })
  t.assert(Object.isFrozen(inserted))
  const updated = collection.update(produce(inserted, (draft: any) => { draft.name = 'name1' }))
  t.assert(Object.isFrozen(updated))
  const deleted = collection.remove(updated)
  t.assert(Object.isFrozen(deleted))
  t.assert(insertedSpy.calledOnce)
  const [insertedDoc, insertedPatches] = insertedSpy.getCall(0).args
  t.assert(Object.isFrozen(insertedDoc))
  t.deepEqual(withoutMeta(insertedDoc), { $loki: 1, id: 'id1' })
  t.is(insertedPatches, undefined)
  t.assert(updatedSpy.calledOnce)
  const [updatedDoc, updatedPatches] = updatedSpy.getCall(0).args
  t.assert(Object.isFrozen(updatedDoc))
  t.deepEqual(withoutMeta(updatedDoc), { $loki: 1, id: 'id1', name: 'name1' })
  t.is(updatedPatches, undefined)
  t.assert(deletedSpy.calledOnce)
  const [deletedDoc, deletedPatches] = deletedSpy.getCall(0).args
  t.assert(Object.isFrozen(deletedDoc))
  t.deepEqual(withoutMeta(deletedDoc), { $loki: 1, id: 'id1', name: 'name1' })
  t.is(deletedPatches, undefined)
})

test('should emit events with patches after insert/update/remove', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const collection = db.addCollection('collection', {
    hooks: {
      config: [['immutable', {
        patches: true,
        insertEvent: 'inserted', updateEvent: 'updated', deleteEvent: 'deleted',
        immer
      }]]
    }
  })
  const insertedSpy = sinon.spy()
  collection.addListener('inserted', insertedSpy)
  const updatedSpy = sinon.spy()
  collection.addListener('updated', updatedSpy)
  const deletedSpy = sinon.spy()
  collection.addListener('deleted', deletedSpy)
  const inserted = collection.insert({ id: 'id1' })
  t.assert(Object.isFrozen(inserted))
  const updateDraft = immer.createDraft(inserted)
  updateDraft.name = 'name1'
  const updated = collection.update(updateDraft)
  t.assert(Object.isFrozen(updated))
  const deleted = collection.remove(updated)
  t.assert(Object.isFrozen(deleted))
  t.assert(insertedSpy.calledOnce)
  const [insertedDoc, insertedPatches] = insertedSpy.getCall(0).args
  t.assert(Object.isFrozen(insertedDoc))
  t.deepEqual(withoutMeta(insertedDoc), { $loki: 1, id: 'id1' })
  t.deepEqual(insertedPatches, {
    "patches": [
      {
        "op": "add",
        "path": [
          "id"
        ],
        "value": "id1"
      }
    ],
    "reversePatches": [
      {
        "op": "remove",
        "path": [
          "id"
        ]
      }
    ]
  })
  t.assert(updatedSpy.calledOnce)
  const [updatedDoc, updatedPatches] = updatedSpy.getCall(0).args
  t.assert(Object.isFrozen(updatedDoc))
  t.deepEqual(withoutMeta(updatedDoc), { $loki: 1, id: 'id1', name: 'name1' })
  t.deepEqual(updatedPatches, {
    "patches": [
      {
        "op": "add",
        "path": [
          "name"
        ],
        "value": "name1"
      }
    ],
    "reversePatches": [
      {
        "op": "remove",
        "path": [
          "name"
        ]
      }
    ]
  })
  t.assert(deletedSpy.calledOnce)
  const [deletedDoc, deletedPatches] = deletedSpy.getCall(0).args
  t.assert(Object.isFrozen(deletedDoc))
  t.deepEqual(withoutMeta(deletedDoc), { $loki: 1, id: 'id1', name: 'name1' })
  t.is(deletedPatches, undefined)
})

test('should freeze array of documents after insert/update/remove', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const collection = db.addCollection('collection', {
    hooks: {
      config: [['immutable', {}]]
    }
  })
  const inserted = collection.insert([{ id: 'id1' }, { id: 'id2' }])
  t.assert(Object.isFrozen(inserted[0]) && Object.isFrozen(inserted[1]))
  collection.update(collection.find().map((doc: any) => produce(doc, (draft: any) => { draft.name = 'name1' })))
  const updated = collection.find()
  t.assert(Object.isFrozen(updated[0]) && Object.isFrozen(updated[1]))
  collection.remove(updated)
  t.deepEqual(collection.find(), [])
})

test('should emit event with patches after insert/update/remove of array of documents', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const collection = db.addCollection('collection', {
    hooks: {
      config: [['immutable', {
        patches: true,
        insertEvent: 'inserted', updateEvent: 'updated', deleteEvent: 'deleted',
        immer
      }]]
    }
  })
  const insertedSpy = sinon.spy()
  collection.addListener('inserted', insertedSpy)
  const updatedSpy = sinon.spy()
  collection.addListener('updated', updatedSpy)
  const deletedSpy = sinon.spy()
  collection.addListener('deleted', deletedSpy)
  const inserted = collection.insert([{ id: 'id1' }, { id: 'id2' }])
  t.assert(Object.isFrozen(inserted[0]) && Object.isFrozen(inserted[1]))
  t.assert(insertedSpy.calledOnce)
  const [insertedDocs, insertedPatches] = insertedSpy.getCall(0).args
  t.deepEqual(withoutMeta(insertedDocs[0]), { $loki: 1, id: 'id1' })
  t.deepEqual(insertedPatches[0], {
    "patches": [
      {
        "op": "add",
        "path": [
          "id"
        ],
        "value": "id1"
      }
    ],
    "reversePatches": [
      {
        "op": "remove",
        "path": [
          "id"
        ]
      }
    ]
  })
  t.deepEqual(withoutMeta(insertedDocs[1]), { $loki: 2, id: 'id2' })
  t.deepEqual(insertedPatches[1], {
    "patches": [
      {
        "op": "add",
        "path": [
          "id"
        ],
        "value": "id2"
      }
    ],
    "reversePatches": [
      {
        "op": "remove",
        "path": [
          "id"
        ]
      }
    ]
  })
  const updated0Draft = immer.createDraft(insertedDocs[0])
  updated0Draft.name = 'name1'
  const updated1Draft = immer.createDraft(insertedDocs[1])
  updated1Draft.name = 'name2'
  collection.update([updated0Draft, updated1Draft])
  const updated = collection.find()
  t.assert(Object.isFrozen(updated[0]) && Object.isFrozen(updated[1]))
  t.deepEqual(withoutMeta(updated[0]), { $loki: 1, id: 'id1', name: 'name1' })
  t.deepEqual(withoutMeta(updated[1]), { $loki: 2, id: 'id2', name: 'name2' })
  t.is(updatedSpy.callCount, 2)
  const [updated0Doc, updated0Patch] = updatedSpy.getCall(0).args
  t.deepEqual(updated0Doc, updated[0])
  t.deepEqual(updated0Patch, {
    "patches": [
      {
        "op": "add",
        "path": [
          "name"
        ],
        "value": "name1"
      }
    ],
    "reversePatches": [
      {
        "op": "remove",
        "path": [
          "name"
        ]
      }
    ]
  })
  const [updated1Doc, updated1Patch] = updatedSpy.getCall(1).args
  t.deepEqual(updated1Doc, updated[1])
  t.deepEqual(updated1Patch, {
    "patches": [
      {
        "op": "add",
        "path": [
          "name"
        ],
        "value": "name2"
      }
    ],
    "reversePatches": [
      {
        "op": "remove",
        "path": [
          "name"
        ]
      }
    ]
  })
  collection.remove(updated)
  t.deepEqual(collection.find(), [])
  t.is(deletedSpy.callCount, 2)
  t.assert(Object.isFrozen(deletedSpy.getCall(0).args[0]))
  t.deepEqual(withoutMeta(deletedSpy.getCall(0).args), [{
    $loki: 1,
    id: 'id1',
    name: 'name1'
  }])
  t.assert(Object.isFrozen(deletedSpy.getCall(1).args[0]))
  t.deepEqual(withoutMeta(deletedSpy.getCall(1).args), [{
    $loki: 2,
    id: 'id2',
    name: 'name2'
  }])
})

test('should deep freeze document after insert/update/remove', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const collection = db.addCollection('collection', {
    hooks: {
      config: [['immutable', {}]]
    }
  })
  const inserted = collection.insert({ id: 'id1', name: { first: 'F', last: 'L' } })
  t.deepEqual(withoutMeta(inserted), { $loki: 1, id: 'id1', name: { first: 'F', last: 'L' } })
  t.assert(Object.isFrozen(inserted))
  t.assert(Object.isFrozen(inserted.name))
  const updated = collection.update(produce(inserted, (draft: any) => {
    draft.name.first = 'F1'
  }))
  t.deepEqual(withoutMeta(updated), { $loki: 1, id: 'id1', name: { first: 'F1', last: 'L' } })
  t.assert(Object.isFrozen(updated))
  t.assert(Object.isFrozen(updated.name))
  collection.remove(updated)
})

test('should maintain indices accross inserts', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const collection = db.addCollection('collection', {
    indices: ['name'],
    hooks: {
      config: [['immutable', {}]]
    }
  })
  collection.insert([
    { name: 'mjolnir', owner: 'thor', maker: 'dwarves' },
    { name: 'gungnir', owner: 'odin', maker: 'elves' },
    { name: 'tyrfing', owner: 'Svafrlami', maker: 'dwarves' },
    { name: 'draupnir', owner: 'odin', maker: 'elves' }
  ])
  // force index build
  collection.find({ name: 'mjolnir' })
  let bi = collection.binaryIndices.name
  t.is(bi.values.length, 4)
  t.is(bi.values[0], 3)
  t.is(bi.values[1], 1)
  t.is(bi.values[2], 0)
  t.is(bi.values[3], 2)

  collection.insert({ name: 'gjallarhorn', owner: 'heimdallr', maker: 'Gjöll' })

  // force index build
  collection.find({ name: 'mjolnir' })

  // reaquire values array
  bi = collection.binaryIndices.name

  t.is(bi.values[0], 3)
  t.is(bi.values[1], 4)
  t.is(bi.values[2], 1)
  t.is(bi.values[3], 0)
  t.is(bi.values[4], 2)
})

test('should maintain indices across updates', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const items = db.addCollection('collection', {
    indices: ['name'],
    hooks: {
      config: [['immutable', {}]]
    }
  })
  items.insert([
    { name: 'mjolnir', owner: 'thor', maker: 'dwarves' },
    { name: 'gungnir', owner: 'odin', maker: 'elves' },
    { name: 'tyrfing', owner: 'Svafrlami', maker: 'dwarves' },
    { name: 'draupnir', owner: 'odin', maker: 'elves' }
  ])

  // force index build
  items.find({ name: 'mjolnir' })

  let bi = items.binaryIndices.name
  t.is(bi.values.length, 4)
  t.is(bi.values[0], 3)
  t.is(bi.values[1], 1)
  t.is(bi.values[2], 0)
  t.is(bi.values[3], 2)

  const tyrfing = items.findOne({ name: 'tyrfing' })
  items.update(produce(tyrfing, (draft: any) => { draft.name = 'etyrfing' }))

  // force index build
  items.find({ name: 'mjolnir' })

  // reaquire values array
  bi = items.binaryIndices.name

  t.is(bi.values[0], 3)
  t.is(bi.values[1], 2)
  t.is(bi.values[2], 1)
  t.is(bi.values[3], 0)
})

test('should maintain indices across removes', t => {
  let a
  let b
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const items = db.addCollection('collection', {
    indices: ['b'],
    hooks: {
      config: [['immutable', {}]]
    }
  })
  for (let idx = 0; idx < 100; idx++) {
    a = Math.floor(Math.random() * 1000)
    b = Math.floor(Math.random() * 1000)
    items.insert({ "a": a, "b": b })
  }

  const result = items.find({ a: { $between: [300, 700] } })

  items.findAndRemove({ a: { $between: [300, 700] } })

  t.is(items.checkIndex('b'), true)

  t.is(items.find().length, 100 - result.length)
})

test('should retrieve records with by', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const coll = db.addCollection('collection', {
    unique: ['username'],
    hooks: {
      config: [['immutable', {}]]
    }
  })
  coll.insert({
    username: 'joe',
    name: 'Joe'
  })
  coll.insert({
    username: 'jack',
    name: 'Jack'
  })
  t.is(coll.by('username', 'joe').name, 'Joe')

  const byUsername = coll.by('username')
  t.is(byUsername('jack').name, 'Jack')

  const joe = coll.by('username', 'joe')
  t.throws(
    () => coll.update(produce(joe, (draft: any) => { draft.username = 'jack' })), 
    { message: 'Duplicate key for property username: jack' }
  )
  coll.update(produce(joe, (draft: any) => { draft.username = 'jim' }))
  t.is(byUsername('jim').username, 'jim')
  t.is(byUsername('jim').name, 'Joe')
})

test('dynamic view: empty filter across changes', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const items = db.addCollection('collection', {
    hooks: {
      config: [['immutable', {}]]
    }
  })
  items.insert([
    { name: 'mjolnir', owner: 'thor', maker: 'dwarves' },
    { name: 'gungnir', owner: 'odin', maker: 'elves' },
    { name: 'tyrfing', owner: 'Svafrlami', maker: 'dwarves' },
    { name: 'draupnir', owner: 'odin', maker: 'elves' }
  ])
  const dv = items.addDynamicView('dv')

  // with no filter, results should be all documents
  let results = dv.data()
  t.is(results.length, 4)

  // find and update a document which will notify view to re-evaluate
  const gungnir = items.findOne({ 'name': 'gungnir' })
  t.is(gungnir.owner, 'odin')
  items.update(produce(gungnir, (draft: any) => { draft.maker = 'dvalin' }))

  results = dv.data()
  t.is(results.length, 4)
})

test('dynamicview: batch removes work as expected', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const items = db.addCollection('collection', {
    hooks: {
      config: [['immutable', {}]]
    }
  })
  const dv = items.addDynamicView('dv')
  dv.applyFind({ a: 1 })

  items.insert([
    { a: 0, b: 1 },
    { a: 1, b: 2 },
    { a: 0, b: 3 },
    { a: 1, b: 4 },
    { a: 0, b: 5 },
    { a: 1, b: 6 },
    { a: 1, b: 7 },
    { a: 1, b: 8 },
    { a: 0, b: 9 }
  ])

  t.is(dv.data().length, 5)

  items.findAndRemove({ b: { $lt: 7 } })

  t.is(dv.data().length, 2)

  const results = dv.branchResultset().simplesort('b').data()

  t.is(results[0].b, 7)
  t.is(results[1].b, 8)
})

test('dynamicviews: (persistent/sorted) view batch removes work as expected', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const items = db.addCollection('collection', {
    hooks: {
      config: [['immutable', {}]]
    }
  })
  const dv = items.addDynamicView('dv', { persistent: true })
  dv.applyFind({ a: 1 })
  dv.applySimpleSort('b')

  items.insert([
    { a: 0, b: 1 },
    { a: 1, b: 2 },
    { a: 0, b: 3 },
    { a: 1, b: 4 },
    { a: 0, b: 5 },
    { a: 1, b: 6 },
    { a: 1, b: 7 },
    { a: 1, b: 8 },
    { a: 0, b: 9 }
  ])

  t.is(dv.data().length, 5)

  items.findAndRemove({ b: { $lt: 7 } })

  const results = dv.data()
  t.is(results.length, 2)
  t.is(results[0].b, 7)
  t.is(results[1].b, 8)
})

test('dynamicview: (persistent/sorted/indexed) view batch removes work as expected', t => {
  const db = new HooksLoki(uuid(), {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const items = db.addCollection('collection', {
    indices: ['b'],
    hooks: {
      config: [['immutable', {}]]
    }
  })
  const dv = items.addDynamicView('dv', { persistent: true })
  dv.applyFind({ a: 1 })
  dv.applySimpleSort('b')

  items.insert([
    { a: 0, b: 1 },
    { a: 1, b: 2 },
    { a: 0, b: 3 },
    { a: 1, b: 4 },
    { a: 0, b: 5 },
    { a: 1, b: 6 },
    { a: 1, b: 7 },
    { a: 1, b: 8 },
    { a: 0, b: 9 }
  ])

  t.is(dv.data().length, 5)

  items.findAndRemove({ b: { $lt: 7 } })

  const results = dv.data()
  t.is(results.length, 2)
  t.is(results[0].b, 7)
  t.is(results[1].b, 8)
})

