# loki-hooks-immutable

A loki-hooks factory function that turns a loki collection into a collection with immutable documents.
Quering the collection will return immutable documents. Insert/update and remove return immutable documents.
The insert and update methods accept immer drafts (created with createDraft) as documents. 
The insert and update methods will then emit insertEvent/updateEvent events with the 
document and the immer patches as arguments. The insertEvent/updateEvent and deleteEvent can be disable by setting
its name to '' in the options.

# Usage

```typescript
import test from 'ava'
import sinon from 'sinon'
import Loki from 'lokijs'
import { createDraft } from 'immer'
import { Hooks } from 'member-hooks'
import { createHooksLoki } from 'loki-hooks'
import { immutable } from '.'


const dbHooks = new Hooks()
const collectionHooks = new Hooks()
collectionHooks.register('immutable', immutable)

const HooksLoki = createHooksLoki(dbHooks, collectionHooks)

test('should make docs immutable, accept immer draft and emit immer patches', t => {
  const db = new HooksLoki('dbname', {
    adapter: new Loki.LokiMemoryAdapter(),
  })
  const collection = db.addCollection('collection', {
    hooks: {
      config: [['immutable', {
        patches: true, // when patches is true, then generate immer patches
        insertEvent: 'inserted', // emit('inserted', doc, immer patches of changes made by app on immer draft)
        updateEvent: 'updated',  // emit('updated', doc, immer patches of changes made by app on immer draft)
        deleteEvent: 'deleted',  // emit('deleted', doc)
        production: false // when set to true, collection documents will not be frozen
      }]]
    }
  })
  const insertedSpy = sinon.spy((doc: any, patches: any) => {
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
  collection.addListener('inserted', insertedSpy)
  const updatedSpy = sinon.spy((doc: any, patches: any) => {
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
  collection.addListener('updated', updatedSpy)
  const deletedSpy = sinon.spy((doc: any) => {
    t.assert(Object.isFrozen(doc))
  })
  collection.addListener('deleted', deletedSpy)
  t.assert(Object.isFrozen(collection.insert({ id: 'id1' }))) // emits 'inserted' event
  t.assert(insertedSpy.calledOnce)
  const inserted = collection.get(1)
  t.assert(Object.isFrozen(inserted))
  const draft = createDraft(inserted)
  draft.name = 'name1'
  collection.update(draft) // emits 'updated' event
  t.assert(updatedSpy.calledOnce)
  const updated = collection.get(1)
  t.assert(Object.isFrozen(updated))
  collection.remove(1) // emits 'deleted' event
  t.assert(deletedSpy.calledOnce)
})
```