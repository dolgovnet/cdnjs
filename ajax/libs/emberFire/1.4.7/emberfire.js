/*!
 * EmberFire is the officially supported adapter for using Firebase with
 * Ember Data. The DS.FirebaseAdapter provides all of the standard DS.Adapter
 * methods and will automatically synchronize the store with Firebase.
 *
 * EmberFire 1.4.7
 * https://github.com/firebase/emberfire/
 * License: MIT
 */
(function() {
    "use strict";
    var ember$$default = window.Ember;
    var ember$data$$default = window.DS;

    var $$$utils$to$promise$$default = function(fn, context, _args, errorMsg) {
      var args = _args || [];
      return new ember$$default.RSVP.Promise(function(resolve, reject) {
        var callback = function(error) {
          if (error) {
            if (errorMsg && typeof error === 'object') {
              error.location = errorMsg;
            }
            reject(error);
          } else {
            resolve();
          }
        };
        args.push(callback);
        fn.apply(context, args);
      });
    };

    var $$$$$$addon$adapters$firebase$$fmt = ember$$default.String.fmt;
    var $$$$$$addon$adapters$firebase$$Promise = ember$$default.RSVP.Promise;
    var $$$$$$addon$adapters$firebase$$forEach = ember$$default.EnumerableUtils.forEach;
    var $$$$$$addon$adapters$firebase$$filter = ember$$default.EnumerableUtils.filter;
    var $$$$$$addon$adapters$firebase$$map = ember$$default.EnumerableUtils.map;
    var $$$$$$addon$adapters$firebase$$indexOf = ember$$default.EnumerableUtils.indexOf;

    var $$$$$$addon$adapters$firebase$$uniq = function (arr) {
      var ret = ember$$default.A();

      arr.forEach(function(k) {
        if ($$$$$$addon$adapters$firebase$$indexOf(ret, k) < 0) {
          ret.push(k);
        }
      });

      return ret;
    };

    var $$$$$$addon$adapters$firebase$$default = ember$data$$default.Adapter.extend(ember$$default.Evented, {

      defaultSerializer: '-firebase',

      /**
        Endpoint paths can be customized by setting the Firebase property on the
        adapter:

        ```js
        DS.FirebaseAdapter.extend({
          firebase: new Firebase('https://<my-firebase>.firebaseio.com/')
        });
        ```

        Requests for `App.Post` now target `https://<my-firebase>.firebaseio.com/posts`.

        @property firebase
        @type {Firebase}
      */

      init: function() {
        var firebase = this.get('firebase');
        if (!firebase || typeof firebase !== 'object') {
          throw new Error('Please set the `firebase` property on the adapter.');
        }
        // If provided Firebase reference was a query (eg: limits), make it a ref.
        this._ref = firebase.ref();
        // Keep track of what types `.findAll()` has been called for
        this._findAllMapForType = {};
        // Keep a cache to check modified relationships against
        this._recordCacheForType = {};
        // Used to batch records into the store
        this._queue = [];
      },

      /**
        Uses push() to generate chronologically ordered unique IDs.
      */
      generateIdForRecord: function() {
        return this._getKey(this._ref.push());
      },

      /**
        Use the Firebase DataSnapshot's key as the record id

        @param {Object} snapshot - A Firebase snapshot
        @param {Object} payload - The payload that will be pushed into the store
        @return {Object} payload
      */
      _assignIdToPayload: function(snapshot) {
        var payload = snapshot.val();
        if (payload !== null && typeof payload === 'object' && typeof payload.id === 'undefined') {
          payload.id = this._getKey(snapshot);
        }
        return payload;
      },

      /**
        Called by the store to retrieve the JSON for a given type and ID. The
        method will return a promise which will resolve when the value is
        successfully fetched from Firebase.

        Additionally, from this point on, the object's value in the store will
        also be automatically updated whenever the remote value changes.
      */
      find: function(store, type, id) {
        var adapter = this;
        var ref = this._getRef(type, id);

        return new $$$$$$addon$adapters$firebase$$Promise(function(resolve, reject) {
          ref.once('value', function(snapshot) {
            var payload = adapter._assignIdToPayload(snapshot);
            adapter._updateRecordCacheForType(type, payload);
            if (payload === null) {
              var error = new Error($$$$$$addon$adapters$firebase$$fmt('no record was found at %@', [ref.toString()]));
                  error.recordId = id;
              reject(error);
            }
            else {
              resolve(payload);
            }
          },
          function(err) {
            reject(err);
          });
        }, $$$$$$addon$adapters$firebase$$fmt('DS: FirebaseAdapter#find %@ to %@', [type, ref.toString()]));
      },

      recordWasPushed: function(store, type, record) {
        if (!record.__listening) {
          this.listenForChanges(store, type, record);
        }
      },

      recordWillUnload: function(store, record) {
        var ref = this._getRef(record.constructor, record.get('id'));
        ref.off('value');
      },

      recordWillDelete: function(store, record) {
        var adapter = this;

        record.eachRelationship(function (key, relationship) {
          if (relationship.kind === 'belongsTo') {
            var parentRecord = record.get(relationship.key);
            var inverseKey = record.inverseFor(relationship.key);
            if (inverseKey && parentRecord.get('id')) {
              var parentRef = adapter._getRef(inverseKey.type, parentRecord.get('id'));
              adapter._removeHasManyRecord(store, parentRef, inverseKey.name, record.id);
            }
          }
        });
      },

      listenForChanges: function(store, type, record) {
        record.__listening = true;
        var serializer = store.serializerFor(type);
        var adapter = this;
        var ref = this._getRef(type, record.get('id'));
        var called = false;
        ref.on('value', function FirebaseAdapter$changeListener(snapshot) {
          if (called) {
            adapter._handleChildValue(store, type, serializer, snapshot);
          }
          called = true;
        });
      },

      /**
       findMany
      */
      findMany: undefined,

      /**
        Called by the store to retrieve the JSON for all of the records for a
        given type. The method will return a promise which will resolve when the
        value is successfully fetched from Firebase.

        Additionally, from this point on, any records of this type that are added,
        removed or modified from Firebase will automatically be reflected in the
        store.
      */
      findAll: function(store, type) {
        var adapter = this;
        var ref = this._getRef(type);

        return new $$$$$$addon$adapters$firebase$$Promise(function(resolve, reject) {
          // Listen for child events on the type
          ref.once('value', function(snapshot) {
            if (!adapter._findAllHasEventsForType(type)) {
              adapter._findAllAddEventListeners(store, type, ref);
            }
            var results = [];
            snapshot.forEach(function(childSnapshot) {
              var payload = adapter._assignIdToPayload(childSnapshot);
              adapter._updateRecordCacheForType(type, payload);
              results.push(payload);
            });
            resolve(results);
          }, function(error) {
            reject(error);
          });
        }, $$$$$$addon$adapters$firebase$$fmt('DS: FirebaseAdapter#findAll %@ to %@', [type, ref.toString()]));
      },

      findQuery: function(store, type, query, recordArray) {
        var adapter = this;
        var ref = this._getRef(type);
        ref = this.applyQueryToRef(ref, query);

        ref.on('child_added', function(snapshot) {
          var record = store.recordForId(type, snapshot.key());

          if (!record || !record.__listening) {
            var payload = adapter._assignIdToPayload(snapshot);
            var serializer = store.serializerFor(type);
            adapter._updateRecordCacheForType(type, payload);
            record = store.push(type, serializer.extractSingle(store, type, payload));
          }

          if (record) {
            recordArray.addObject(record);
          }
        });

        // `child_changed` is already handled by the record's
        // value listener after a store.push. `child_moved` is
        // a much less common case because it relates to priority

        ref.on('child_removed', function(snapshot) {
          var record = store.recordForId(type, snapshot.key());
          if (record) {
            recordArray.removeObject(record);
          }
        });

        // clean up event handlers when the array is being destroyed
        // so that future firebase events wont keep trying to use a
        // destroyed store/serializer
        recordArray.__firebaseCleanup = function () {
          ref.off('child_added');
          ref.off('child_removed');
        };

        return new $$$$$$addon$adapters$firebase$$Promise(function(resolve, reject) {
          // Listen for child events on the type
          ref.once('value', function(snapshot) {
            if (!adapter._findAllHasEventsForType(type)) {
              adapter._findAllAddEventListeners(store, type, ref);
            }
            var results = [];
            snapshot.forEach(function(childSnapshot) {
              var payload = adapter._assignIdToPayload(childSnapshot);
              adapter._updateRecordCacheForType(type, payload);
              results.push(payload);
            });
            resolve(results);
          }, function(error) {
            reject(error);
          });
        }, $$$$$$addon$adapters$firebase$$fmt('DS: FirebaseAdapter#findQuery %@ with %@', [type, query]));
      },

      applyQueryToRef: function (ref, query) {

        if (!query.orderBy) {
          query.orderBy = '_key';
        }

        if (query.orderBy === '_key'){
          ref = ref.orderByKey();
        } else if (query.orderBy === '_value') {
          ref = ref.orderByValue();
        } else if (query.orderBy === '_priority') {
          ref = ref.orderByPriority();
        } else {
          ref = ref.orderByChild(query.orderBy);
        }

        ['limitToFirst', 'limitToLast', 'startAt', 'endAt', 'equalTo'].forEach(function (key) {
          if (query[key] || query[key] === '') {
            ref = ref[key](query[key]);
          }
        });

        return ref;
      },

      /**
        Keep track of what types `.findAll()` has been called for
        so duplicate listeners aren't added
      */
      _findAllMapForType: undefined,

      /**
        Determine if the current type is already listening for children events
      */
      _findAllHasEventsForType: function(type) {
        return !ember$$default.isNone(this._findAllMapForType[type]);
      },

      /**
        After `.findAll()` is called on a type, continue to listen for
        `child_added`, `child_removed`, and `child_changed`
      */
      _findAllAddEventListeners: function(store, type, ref) {
        this._findAllMapForType[type] = true;

        var adapter = this;
        var serializer = store.serializerFor(type);

        ref.on('child_added', function(snapshot) {
          if (!store.hasRecordForId(type, adapter._getKey(snapshot))) {
            adapter._handleChildValue(store, type, serializer, snapshot);
          }
        });
      },

      /**
        Push a new child record into the store
      */
      _handleChildValue: function(store, type, serializer, snapshot) {
        //No idea why we need this, we are alredy turning off the callback by
        //calling ref.off in recordWillUnload. Something is fishy here
        if (store.isDestroying) {
          return;
        }
        var value = snapshot.val();
        if (value === null) {
          var id = this._getKey(snapshot);
          var record = store.getById(type, id);
          //TODO refactor using ED
          if (!record.get('isDeleted')) {
            record.deleteRecord();
          }
        } else {
          var payload = this._assignIdToPayload(snapshot);

          // firebase doesn't send the property for empty relationships
          type.eachRelationship(function (key, relationship) {
            if (relationship.kind === 'hasMany' && !payload[key]) {
              payload[key] = {};
            }
          });

          this._enqueue(function FirebaseAdapter$enqueueStorePush() {
            if (!store.isDestroying) {
              store.push(type, serializer.extractSingle(store, type, payload));
            }
          });
        }
      },

      /**
        `createRecord` is an alias for `updateRecord` because calling \
        `ref.set()` would wipe out any existing relationships
      */
      createRecord: function(store, type, snapshot) {
        var adapter = this;
        var record = snapshot.record || snapshot;
        return this.updateRecord(store, type, snapshot).then(function() {
          adapter.listenForChanges(store, type, record);
        });
      },

      /**
        Called by the store when a record is created/updated via the `save`
        method on a model record instance.

        The `updateRecord` method serializes the record and performs an `update()`
        at the the Firebase location and a `.set()` at any relationship locations
        The method will return a promise which will be resolved when the data and
        any relationships have been successfully saved to Firebase.

        We take an optional record reference, in order for this method to be usable
        for saving nested records as well.

      */
      updateRecord: function(store, type, snapshot) {
        var adapter = this;
        var record = snapshot.record || snapshot;
        var recordRef = record.__firebaseRef || this._getRef(type, record.get('id'));
        var modelName = ember$$default.String.camelize(type.modelName || type.typeKey);
        var recordCache = adapter._getRecordCache(modelName, record.get('id'));

        var pathPieces = recordRef.path.toString().split('/');
        var lastPiece = pathPieces[pathPieces.length-1];
        var serializedRecord = record.serialize({
          includeId: (lastPiece !== record.id) // record has no firebase `key` in path
        });

        return new $$$$$$addon$adapters$firebase$$Promise(function(resolve, reject) {
          var savedRelationships = ember$$default.A();
          record.eachRelationship(function(key, relationship) {
            var save;
            if (relationship.kind === 'hasMany') {
              if (serializedRecord[key]) {
                save = adapter._saveHasManyRelationship(store, type, relationship, serializedRecord[key], recordRef, recordCache);
                savedRelationships.push(save);
                // Remove the relationship from the serializedRecord because otherwise we would clobber the entire hasMany
                delete serializedRecord[key];
              }
            } else {
              if (relationship.options.embedded === true && serializedRecord[key]) {
                save = adapter._saveBelongsToRecord(store, type, relationship, serializedRecord[key], recordRef);
                savedRelationships.push(save);
                delete serializedRecord[key];
              }
            }
          });

          var relationshipsPromise = ember$$default.RSVP.allSettled(savedRelationships);
          var recordPromise = adapter._updateRecord(recordRef, serializedRecord);

          ember$$default.RSVP.hashSettled({relationships: relationshipsPromise, record: recordPromise}).then(function(promises) {
            var rejected = ember$$default.A(promises.relationships.value).filterBy('state', 'rejected');
            if (promises.record.state === 'rejected') {
              rejected.push(promises.record);
            }
            // Throw an error if any of the relationships failed to save
            if (rejected.length !== 0) {
              var error = new Error($$$$$$addon$adapters$firebase$$fmt('Some errors were encountered while saving %@ %@', [type, record.id]));
                  error.errors = rejected.mapBy('reason');
              reject(error);
            } else {
              resolve();
            }
          });
        }, $$$$$$addon$adapters$firebase$$fmt('DS: FirebaseAdapter#updateRecord %@ to %@', [type, recordRef.toString()]));
      },

      //Just update the record itself without caring for the relationships
      _updateRecord: function(recordRef, serializedRecord) {
        return $$$utils$to$promise$$default(recordRef.update, recordRef, [serializedRecord]);
      },

      /**
        Call _saveHasManyRelationshipRecord on each record in the relationship
        and then resolve once they have all settled
      */
      _saveHasManyRelationship: function(store, type, relationship, ids, recordRef, recordCache) {
        if (!ember$$default.isArray(ids)) {
          throw new Error('hasMany relationships must must be an array');
        }
        var adapter = this;
        var idsCache = ember$$default.A(recordCache[relationship.key]);
        var dirtyRecords = [];

        // Added
        var addedRecords = $$$$$$addon$adapters$firebase$$filter(ids, function(id) {
          return !idsCache.contains(id);
        });

        // Dirty
        dirtyRecords = $$$$$$addon$adapters$firebase$$filter(ids, function(id) {
          var type = relationship.type;
          return store.hasRecordForId(type, id) && store.getById(type, id).get('isDirty') === true;
        });

        dirtyRecords = $$$$$$addon$adapters$firebase$$map($$$$$$addon$adapters$firebase$$uniq(dirtyRecords.concat(addedRecords)), function(id) {
          return adapter._saveHasManyRecord(store, relationship, recordRef, id);
        });

        // Removed
        var removedRecords = $$$$$$addon$adapters$firebase$$filter(idsCache, function(id) {
          return !ids.contains(id);
        });

        removedRecords = $$$$$$addon$adapters$firebase$$map(removedRecords, function(id) {
          return adapter._removeHasManyRecord(store, recordRef, relationship.key, id);
        });
        // Combine all the saved records
        var savedRecords = dirtyRecords.concat(removedRecords);
        // Wait for all the updates to finish
        return ember$$default.RSVP.allSettled(savedRecords).then(function(savedRecords) {
          var rejected = ember$$default.A(ember$$default.A(savedRecords).filterBy('state', 'rejected'));
          if (rejected.get('length') === 0) {
            // Update the cache
            recordCache[relationship.key] = ids;
            return savedRecords;
          }
          else {
            var error = new Error($$$$$$addon$adapters$firebase$$fmt('Some errors were encountered while saving a hasMany relationship %@ -> %@', [relationship.parentType, relationship.type]));
                error.errors = ember$$default.A(rejected).mapBy('reason');
            throw error;
          }
        });
      },

      /**
        If the relationship is `async: true`, create a child ref
        named with the record id and set the value to true

        If the relationship is `embedded: true`, create a child ref
        named with the record id and update the value to the serialized
        version of the record
      */
      _saveHasManyRecord: function(store, relationship, parentRef, id) {
        var ref = this._getRelationshipRef(parentRef, relationship.key, id);
        var record = store.getById(relationship.type, id);
        var isEmbedded = relationship.options.embedded === true;
        if (isEmbedded) {
          record.__firebaseRef = ref;
          return record.save();
        }

        return $$$utils$to$promise$$default(ref.set, ref,  [true]);
      },

      /**
        Remove a relationship
      */
      _removeHasManyRecord: function(store, parentRef, key, id) {
        var ref = this._getRelationshipRef(parentRef, key, id);
        return $$$utils$to$promise$$default(ref.remove, ref, [], ref.toString());
      },

      /**
        Save an embedded record
      */
      _saveBelongsToRecord: function(store, type, relationship, id, parentRef) {
        var record = store.getById(relationship.type, id);
        record.__firebaseRef = parentRef.child(relationship.key);
        return record.save();
      },

      /**
        Called by the store when a record is deleted.
      */
      deleteRecord: function(store, type, snapshot) {
        var record = snapshot.record || snapshot;
        var ref = record.__firebaseRef || this._getRef(type, record.get('id'));
        return $$$utils$to$promise$$default(ref.remove, ref);
      },

      /**
        Determines a path fo a given type
      */
      pathForType: function(typeName) {
        var camelized = ember$$default.String.camelize(typeName);
        return ember$$default.String.pluralize(camelized);
      },

      /**
        Return a Firebase reference for a given type and optional ID.
      */
      _getRef: function(type, id) {
        var ref = this._ref;
        var typeName = type;

        // Fallback to typeKey for Ember Data < 1.0beta.18
        if (type && (type.modelName || type.typeKey)) {
          typeName = type.modelName || type.typeKey;
        }
        if (typeName) {
          ref = ref.child(this.pathForType(typeName));
        }
        if (id) {
          ref = ref.child(id);
        }
        return ref;
      },

      /**
        Return a Firebase reference based on a relationship key and record id
      */
      _getRelationshipRef: function(ref, key, id) {
        return ref.child(key).child(id);
      },

      /**
        The amount of time (ms) before the _queue is flushed
      */
      _queueFlushDelay: (1000/60), // 60fps

      /**
        Called after the first item is pushed into the _queue
      */
      _queueScheduleFlush: function() {
        ember$$default.run.later(this, this._queueFlush, this._queueFlushDelay);
      },

      /**
        Call each function in the _queue and the reset the _queue
      */
      _queueFlush: function() {
        $$$$$$addon$adapters$firebase$$forEach(this._queue, function FirebaseAdapter$flushQueueItem(queueItem) {
          var fn = queueItem[0];
          var args = queueItem[1];
          fn.apply(null, args);
        });
        this._queue.length = 0;
      },

      /**
        Push a new function into the _queue and then schedule a
        flush if the item is the first to be pushed
      */
      _enqueue: function(callback, args) {
        //Only do the queueing if we scheduled a delay
        if (this._queueFlushDelay) {
          var length = this._queue.push([callback, args]);
          if (length === 1) {
            this._queueScheduleFlush();
          }
        } else {
          callback.apply(null, args);
        }
      },

      /**
        A cache of hasMany relationships that can be used to
        diff against new relationships when a model is saved
      */
      _recordCacheForType: undefined,

      /**
        _updateHasManyCacheForType
      */
      _updateRecordCacheForType: function(type, payload) {
        if (!payload) { return; }
        var id = payload.id;
        var typeName = ember$$default.String.camelize(type.modelName || type.typeKey);
        var cache = this._getRecordCache(typeName, id);
        // Only cache relationships for now
        type.eachRelationship(function(key, relationship) {
          if (relationship.kind === 'hasMany') {
            var ids = payload[key];
            cache[key] = !ember$$default.isNone(ids) ? ember$$default.A(ember$$default.keys(ids)) : ember$$default.A();
          }
        });
      },

      /**
        Get or create the cache for a record
       */
      _getRecordCache: function (modelName, id) {
        var cache = this._recordCacheForType;
        cache[modelName] = cache[modelName] || {};
        cache[modelName][id] = cache[modelName][id] || {};
        return cache[modelName][id];
      },

      /**
       * A utility for retrieving the key name of a Firebase ref or
       * DataSnapshot. This is backwards-compatible with `name()`
       * from Firebase 1.x.x and `key()` from Firebase 2.0.0+. Once
       * support for Firebase 1.x.x is dropped in EmberFire, this
       * helper can be removed.
       */
      _getKey: function(refOrSnapshot) {
        return (typeof refOrSnapshot.key === 'function') ? refOrSnapshot.key() : refOrSnapshot.name();
      }
    });

    var $$$$$$addon$serializers$firebase$$map = ember$$default.EnumerableUtils.map;
    var $$$$$$addon$serializers$firebase$$fmt = ember$$default.String.fmt;

    var $$$$$$addon$serializers$firebase$$default = ember$data$$default.JSONSerializer.extend(ember$$default.Evented, {

      //We need to account for Firebase turning key/value pairs with ids '1' and '0' into arrays
      //See https://github.com/firebase/emberfire/issues/124
      _normalizeNumberIDs: function(hash, key) {
        var newHash = [];
        if (hash[key][0] === true) {
          newHash.push('0');
        }
        if (hash[key][1] === true) {
          newHash.push('1');
        }
        hash[key] = newHash;
      },

      normalizeHasMany: function(type, hash, relationship) {
        var key = relationship.key;
        if (typeof hash[key] === 'object' && !ember$$default.isArray(hash[key])) {
          hash[key] = ember$$default.keys(hash[key]);
        }
        //We need to account for Firebase turning key/value pairs with ids '1' and '0' into arrays
        //See https://github.com/firebase/emberfire/issues/124
        else if (ember$$default.isArray(hash[key]) && hash[key].length < 3 && (hash[key][0] === true || hash[key][1] === true)) {
          this._normalizeNumberIDs(hash, key);
        }
        else if (ember$$default.isArray(hash[key])) {
          throw new Error($$$$$$addon$serializers$firebase$$fmt('%@ relationship %@(\'%@\') must be a key/value map in Firebase. Example: { "%@": { "%@_id": true } }', [type.toString(), relationship.kind, relationship.type.typeKey, key, relationship.type.typeKey]));
        }
      },

      normalizeEmbeddedHasMany: function(type, hash, relationship, ref) {
        var key = relationship.key;
        var embedded = hash[key];
        var embeddedRef;
        if (!hash[key]) {
          return;
        }
        ref = ref || this.store.adapterFor(type)._getRef(type, hash.id);

        for (var id in embedded) {
          var payload = embedded[id];
          if (payload !== null && typeof payload === 'object') {
            payload.id = id;
          }
          embeddedRef = ref.child(key).child(id);
          var record = this.store.push(relationship.type, this.normalize(relationship.type, payload, embeddedRef));
          record.__firebaseRef = embeddedRef;
        }
        hash[key] = ember$$default.keys(hash[key]);
      },

      normalizeEmbeddedBelongsTo: function(type, hash, relationship, ref) {
        var key = relationship.key;
        if (!hash[key]) {
          return;
        }

        ref = ref || this.store.adapterFor(type)._getRef(type, hash.id);

        var payload = hash[key];
        if (typeof payload.id !== 'string') {
          throw new Error($$$$$$addon$serializers$firebase$$fmt('Embedded relationship "%@" of "%@" must contain an "id" property in the payload', [relationship.type.typeKey, type]));
        }
        var embeddedRef = ref.child(key);
        var record = this.store.push(relationship.type, this.normalize(relationship.type, payload, embeddedRef));
        record.__firebaseRef = embeddedRef;

        hash[key] = payload.id;
      },

      normalizeBelongsTo: ember$$default.K,
      /**
        Called after `extractSingle()`. This method checks the model
        for `hasMany` relationships and makes sure the value is an object.
        The object is then converted to an Array using `Ember.keys`
      */
      normalize: function(type, hash, ref) {
        var serializer = this;
        // Check if the model contains any 'hasMany' relationships
        type.eachRelationship(function(key, relationship) {
          if (relationship.kind === 'hasMany') {
            if (relationship.options.embedded) {
              serializer.normalizeEmbeddedHasMany(type, hash, relationship, ref);
            } else {
              serializer.normalizeHasMany(type, hash, relationship);
            }
          } else {
            if (relationship.options.embedded) {
              serializer.normalizeEmbeddedBelongsTo(type, hash, relationship, ref);
            } else {
              serializer.normalizeBelongsTo(type, hash, relationship);
            }
          }
        });
        return this._super.apply(this, arguments);
      },

      /**
        Called on a records returned from `find()` and all records
        returned from `findAll()`

        This method also checks for `embedded: true`, extracts the
        embedded records, pushes them into the store, and then replaces
        the records with an array of ids
      */
      extractSingle: function(store, type, payload) {
        return this.normalize(type, payload);
      },

      /**
        Called after the adpter runs `findAll()` or `findMany()`. This method runs
        `extractSingle()` on each item in the payload and as a result each item
        will have `normalize()` called on it
      */
      extractArray: function(store, type, payload) {
        return $$$$$$addon$serializers$firebase$$map(payload, function(item) {
          return this.extractSingle(store, type, item);
        }, this);
      },

      /**
        Overrides ember-data's `serializeHasMany` to serialize oneToMany
        relationships.
      */
      serializeHasMany: function(snapshot, json, relationship) {
        var record = snapshot.record || snapshot;
        var key = relationship.key;
        var payloadKey = this.keyForRelationship ? this.keyForRelationship(key, "hasMany") : key;
        json[payloadKey] = ember$$default.A(record.get(key)).mapBy('id');
      },

      serializeBelongsTo: function(snapshot, json, relationship) {
        this._super(snapshot, json, relationship);
        var key = relationship.key;
        // var payloadKey = this.keyForRelationship ? this.keyForRelationship(key, "belongsTo") : relationship.key;
        if (typeof json[key] === "undefined" || json[key] === '') {
          delete json[key];
        }
      }

    });

    var firebase$$default = window.Firebase;

    var $$$$$$addon$initializers$emberfire$$VERSION = '1.4.7';

    if (ember$$default.libraries) {
      if (firebase$$default.SDK_VERSION) {
        ember$$default.libraries.registerCoreLibrary('Firebase', firebase$$default.SDK_VERSION);
      }

      ember$$default.libraries.registerCoreLibrary('EmberFire', $$$$$$addon$initializers$emberfire$$VERSION);
    }

    var $$$$$$addon$initializers$emberfire$$default = {
      name: 'emberfire',
      before: 'ember-data',
      initialize: function (container, app) {
        app.register('adapter:-firebase', $$$$$$addon$adapters$firebase$$default);
        app.register('serializer:-firebase', $$$$$$addon$serializers$firebase$$default);

        // Monkeypatch the store until ED gives us a good way to listen to push events
        if (!ember$data$$default.Store.prototype._emberfirePatched) {
          ember$data$$default.Store.reopen({
            _emberfirePatched: true,
            push: function(typeName, data, _partial) {
              var record = this._super(typeName, data, _partial);
              var adapter = this.adapterFor(record.constructor);
              if (adapter.recordWasPushed) {
                adapter.recordWasPushed(this, typeName, record);
              }
              return record;
            },

            recordWillUnload: function(record) {
              var adapter = this.adapterFor(record.constructor);
              if (adapter.recordWillUnload) {
                adapter.recordWillUnload(this, record);
              }
            },

            recordWillDelete: function (record) {
              var adapter = this.adapterFor(record.constructor);
              if (adapter.recordWillDelete) {
                adapter.recordWillDelete(this, record);
              }
            }
          });
        }

        if (!ember$data$$default.Model.prototype._emberfirePatched) {
          ember$data$$default.Model.reopen({
            _emberfirePatched: true,
            unloadRecord: function() {
              this.store.recordWillUnload(this);
              return this._super();
            },
            deleteRecord: function () {
              this.store.recordWillDelete(this);
              this._super();
            },

            ref: function () {
              if (this.__firebaseRef) {
                return this.__firebaseRef;
              }

              var adapter = this.store.adapterFor(this.constructor);
              if (adapter._getRef) {
                return adapter._getRef(this.constructor, this.id);
              }
            }
          });
        }

        if (!ember$data$$default.AdapterPopulatedRecordArray.prototype._emberfirePatched) {
          ember$data$$default.AdapterPopulatedRecordArray.reopen({
            _emberfirePatched: true,
            willDestroy: function() {
              if (this.__firebaseCleanup) {
                this.__firebaseCleanup();
              }
              return this._super();
            }
          });
        }

        ember$data$$default.FirebaseAdapter = $$$$$$addon$adapters$firebase$$default;
        ember$data$$default.FirebaseSerializer = $$$$$$addon$serializers$firebase$$default;
      }
    };

    window.DS.FirebaseAdapter = $$$$$$addon$adapters$firebase$$default;
    window.DS.FirebaseSerializer = $$$$$$addon$serializers$firebase$$default;

    ember$$default.onLoad('Ember.Application', function(Application) {
      Application.initializer($$$$$$addon$initializers$emberfire$$default);
    });
}).call(this);
//# sourceMappingURL=emberfire.js.map