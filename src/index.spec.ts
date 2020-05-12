import test from 'ava'
import Loki from 'lokijs'
import * as immer from 'immer'
import { Hooks } from 'member-hooks'
import { createHooksLoki } from 'loki-hooks'
import { immutable } from '.'


const dbHooks = new Hooks()
const collectionHooks = new Hooks()
collectionHooks.register('immutable', immutable)

const HooksLoki = createHooksLoki(dbHooks, collectionHooks)

test('should insert immutable docs', t => {
  const db = new HooksLoki('dbname', {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const collection = db.addCollection('collection', {
    hooks: {
      config: [['immutable', {
        immer, // when set, document can be inserted and updated with an immer draft
        patches: true, // when the immer options is set and patches is true, then generate immer patches
        insertEvent: 'inserted', // emit('inserted', doc, immer patches of changes made by app on immer draft)
        updateEvent: 'updated',  // emit('updated', doc, immer patches of changes made by app on immer draft)
        removeEvent: 'deleted',  // emit('deleted', doc)
        production: false // when set to true, collection documents will not be frozen
      }]]
    }
  })
  collection.addListener('inserted', (doc: any, patches: any) => {
    t.assert(Object.isFrozen(doc))
    t.deepEqual(patches, {
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
  })
  collection.addListener('updated', (doc: any, patches: any) => {
    t.assert(Object.isFrozen(doc))
    t.deepEqual(patches, {
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
  })
  collection.addListener('deleted', (doc: any) => {
    t.assert(Object.isFrozen(doc))
  })
  t.assert(Object.isFrozen(collection.insert({ id: 'id1' }))) // emits 'inserted' event
  const inserted = collection.get(1)
  t.assert(Object.isFrozen(inserted))
  const draft = immer.createDraft(inserted)
  draft.name = 'name1'
  collection.update(draft) // emits 'updated' event
  const updated = collection.get(1)
  t.assert(Object.isFrozen(updated))
  collection.remove(1) // emits 'deleted' event
})