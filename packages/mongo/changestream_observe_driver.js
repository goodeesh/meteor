import { Meteor } from 'meteor/meteor';
import { LocalCollection } from 'meteor/minimongo';
import { Random } from 'meteor/random';
import { EventEmitter } from 'events';

const SUPPORTED_OPERATIONS = ['insert', 'update', 'replace', 'delete'];

export class ChangeStreamObserveDriver extends EventEmitter {
  constructor(options) {
    super();
    const self = this;
    
    
    this._usesChangeStreams = true;
    this._cursorDescription = options.cursorDescription;
    this._mongoHandle = options.mongoHandle;
    this._multiplexer = options.multiplexer;
    this._ordered = options.ordered;
  this._changeStreams = new Map(); // Map to store streams by operation
    this._stopped = false;
    
  // Simple rate limiting to avoid spam (no batch processing)
    this._lastEventTime = 0;
    this._minEventInterval = 1; // 1ms mínimo entre eventos
    
    // Use the matcher passed from mongo_connection.js
    this._matcher = options.matcher;
    
  // Fallback: create matcher if not provided
    if (!this._matcher) {
      // Import Minimongo locally to avoid circular dependencies
      const { Minimongo } = require('meteor/minimongo');
      this._matcher = new Minimongo.Matcher(this._cursorDescription.selector);
    }
    
  // For debugging
    this._id = options.id || Random.id();
    
  // Projection function similar to oplog driver
    const projection = this._cursorDescription.options.projection || this._cursorDescription.options.fields;
    if (projection) {
      this._projectionFn = LocalCollection._compileProjection(projection);
    } else {
      this._projectionFn = (doc) => doc;
    }
    
    this._setupEventHandlers();
    
    this._startWatching();
  }

  _setupEventHandlers() {
  // Event handlers that process events directly (no batch)
    this.on('insert', (data) => this._processEventDirect('insert', data));
    this.on('update', (data) => this._processEventDirect('update', data));
    this.on('replace', (data) => this._processEventDirect('replace', data));
    this.on('delete', (data) => this._processEventDirect('delete', data));
  }

  _processEventDirect(operation, data) {
  // Simple rate limiting to avoid spam
    const now = Date.now();
    
    if (now - this._lastEventTime < this._minEventInterval) {
  // If too fast, process on next tick (but without significant delay)
      setImmediate(() => this._handleEvent(operation, data));
      return;
    }
    
    this._lastEventTime = now;
    
  // Process event immediately (like oplog driver)
    this._handleEvent(operation, data);
  }

  _handleEvent(operation, data) {
    try {
      switch (operation) {
        case 'insert':
          this._handleInsert(data.id, data.fullDocument);
          break;
        case 'update':
          this._handleUpdate(data.id, data.fullDocument, data.fullDocumentBeforeChange);
          break;
        case 'replace':
          this._handleReplace(data.id, data.fullDocument, data.fullDocumentBeforeChange);
          break;
        case 'delete':
          this._handleDelete(data.id, data.fullDocumentBeforeChange);
          break;
      }
    } catch (error) {
      console.error(`Error processing ${operation} event:`, error);
    }
  }

  async _startWatching() {
    const self = this;
    
    if (this._stopped) return;
    
    try {
      const collection = this._mongoHandle.rawCollection(this._cursorDescription.collectionName);
      
  // Only send initial adds if the multiplexer is not ready yet
      if (!this._multiplexer._ready()) {
        await this._sendInitialAdds(collection);
      }
      
  // Create a change stream for each operation type
      await this._createOperationStreams(collection);
      
      console.log(`🔥 ChangeStream: Created ${this._changeStreams.size} operation-specific streams for ${this._cursorDescription.collectionName}`);
      
    } catch (error) {
      console.error('Failed to start ChangeStream:', error);
      throw error;
    }
  }

  async _createOperationStreams(collection) {
    const self = this;
    
  // Create streams for each operation
    for (const operation of SUPPORTED_OPERATIONS) {
      try {
        const pipeline = this._buildPipelineForOperation(operation);
        const changeStreamOptions = {
          fullDocument: operation === 'delete' ? 'default' : 'updateLookup',
          fullDocumentBeforeChange: 'whenAvailable',
        };

        const changeStream = collection.watch(pipeline, changeStreamOptions);
        
  // Set up handlers specific to this operation
        this._setupStreamHandlers(changeStream, operation);
        
  // Store the stream
        this._changeStreams.set(operation, changeStream);
        
        
      } catch (error) {
        console.error(`Failed to create ${operation} stream:`, error);
        throw error;
      }
    }
  }

  _buildPipelineForOperation(operation) {
  // Pipeline specific for each operation type
    const pipeline = [
      {
        $match: {
          operationType: operation
        }
      }
    ];

    return pipeline;
  }

  _setupStreamHandlers(changeStream, operation) {
    const self = this;

    changeStream.on('change', Meteor.bindEnvironment((change) => {
      if (self._stopped) return;
      // Emit internal event specific to this operation
      self._emitOperationEvent(operation, change);
    }));

    changeStream.on('error', Meteor.bindEnvironment((error) => {
      if (self._stopped) return;
      console.error(`ChangeStream ${operation} error for ${self._cursorDescription.collectionName}:`, error);
      
  // Try to restart after a delay
      setTimeout(() => {
        if (!self._stopped) {
          self._restartOperationStream(operation);
        }
      }, 1000);
    }));

    changeStream.on('close', Meteor.bindEnvironment(() => {
      if (!self._stopped) {
        console.warn(`ChangeStream ${operation} unexpectedly closed for ${self._cursorDescription.collectionName}`);
        setTimeout(() => {
          if (!self._stopped) {
            self._restartOperationStream(operation);
          }
        }, 1000);
      }
    }));
  }

  _emitOperationEvent(operation, change) {
    const { documentKey, fullDocument, fullDocumentBeforeChange } = change;
    const id = documentKey._id;

  // Prepare event data
    const eventData = {
      id,
      collection: this._cursorDescription.collectionName
    };

  // Add specific data based on the operation type
    switch (operation) {
      case 'insert':
        eventData.fullDocument = fullDocument;
        break;
      case 'update':
      case 'replace':
        eventData.fullDocument = fullDocument;
        eventData.fullDocumentBeforeChange = fullDocumentBeforeChange;
        eventData.updateDescription = change.updateDescription;
        break;
      case 'delete':
        eventData.fullDocumentBeforeChange = fullDocumentBeforeChange;
        break;
    }

  // Emit internal event (will be processed directly)
    this.emit(operation, eventData);
  }

  async _restartOperationStream(operation) {
    try {
      const stream = this._changeStreams.get(operation);
      if (stream) {
        await stream.close();
      }

  // Recreate the stream for this operation
      const collection = this._mongoHandle.rawCollection(this._cursorDescription.collectionName);
      const pipeline = this._buildPipelineForOperation(operation);
      const changeStreamOptions = {
        fullDocument: operation === 'delete' ? 'default' : 'updateLookup',
        fullDocumentBeforeChange: 'whenAvailable',
      };

      const newStream = collection.watch(pipeline, changeStreamOptions);
      this._setupStreamHandlers(newStream, operation);
      this._changeStreams.set(operation, newStream);
      
      console.log(`🔄 ChangeStream ${operation} successfully restarted for ${this._cursorDescription.collectionName}`);
    } catch (error) {
      console.error(`Failed to restart ${operation} ChangeStream:`, error);
    }
  }

  async _sendInitialAdds(collection) {
    if (this._stopped) return;
    try {
      // Build the same selector and options that the cursor would use
      const selector = this._cursorDescription.selector || {};
      const options = { ...this._cursorDescription.options };
      // Remove some options that don't apply to find()
      delete options.tailable;
      delete options.oplogReplay;
      console.log(`ChangeStream: Sending initial adds for collection ${this._cursorDescription.collectionName}`);
      console.log(`ChangeStream: Selector:`, selector);
      // Find all existing documents
      const cursor = collection.find(selector, options);
      const docs = await cursor.toArray();
      // Send 'added' for each existing document that matches our matcher
      for (const doc of docs) {
        if (this._stopped) return;
        if (this._matcher && this._matcher.documentMatches(doc).result) {
          const projectedDoc = this._projectionFn ? this._projectionFn(doc) : doc;
          this._multiplexer.added(doc._id, projectedDoc);
        } else if (!this._matcher) {
          // If no matcher, include all documents
          const projectedDoc = this._projectionFn ? this._projectionFn(doc) : doc;
          this._multiplexer.added(doc._id, projectedDoc);
        }
      }
      // Mark that initial adds are complete
      if (!this._multiplexer._ready()) {
        this._multiplexer.ready();
        console.log(`ChangeStream: Initial adds complete for ${this._cursorDescription.collectionName} (${docs.length} docs)`);
      } else {
        console.warn(`ChangeStream: Multiplexer already ready for ${this._cursorDescription.collectionName}`);
      }
    } catch (error) {
      console.error('Error sending initial adds for ChangeStream:', error);
      throw error;
    }
  }

  // Event handlers

  _handleInsert(id, doc) {
  // Apply projection and check if document matches our criteria
    const matches = this._matcher ? this._matcher.documentMatches(doc).result : true;
    if (matches) {
      const projectedDoc = this._projectionFn ? this._projectionFn(doc) : doc;
  // Measure Change Stream notification latency
      if (doc.createdAt) {
        const now = Date.now();
        const insertedAt = new Date(doc.createdAt).getTime();
        const latencyMs = now - insertedAt;
        console.log(`⏱️ ChangeStream INSERT latency: ${latencyMs} ms (ID: ${id})`);
      }
      this._multiplexer.added(id, projectedDoc);
    }
  }

  _handleUpdate(id, docAfter, docBefore) {
    const matchesAfter = this._matcher ? this._matcher.documentMatches(docAfter || {}).result : true;
    const matchesBefore = (docBefore && this._matcher) ? this._matcher.documentMatches(docBefore).result : false;
    
    
    if (matchesAfter && matchesBefore) {
      // Document matched before and after - it's a change
      const projectedDoc = this._projectionFn ? this._projectionFn(docAfter) : docAfter;
      this._multiplexer.changed(id, projectedDoc);
    } else if (matchesAfter && !matchesBefore) {
      // Document didn't match before but matches now - it's an add
      const projectedDoc = this._projectionFn ? this._projectionFn(docAfter) : docAfter;
      this._multiplexer.added(id, projectedDoc);
    } else if (!matchesAfter && matchesBefore) {
      // Document matched before but doesn't match now - it's a remove
      this._multiplexer.removed(id);
    }
    // If neither matches before nor after, ignore
  }

  _handleReplace(id, docAfter, docBefore) {
  // Handle replace similar to update
    this._handleUpdate(id, docAfter, docBefore);
  }

  _handleDelete(id, docBefore) {
  // For deletes, we only care if the document was in our result set before
    if (docBefore && this._matcher && this._matcher.documentMatches(docBefore).result) {
      this._multiplexer.removed(id);
    } else if (!docBefore || !this._matcher) {
  // If we don't have the before document or no matcher, assume it might have been in our set
  // This is a limitation - we might send unnecessary removes
      this._multiplexer.removed(id);
    }
  }

  async stop() {
    if (this._stopped) return;
    
    this._stopped = true;
    
  // Close all change streams
    for (const [operation, stream] of this._changeStreams) {
      try {
        await stream.close();
      } catch (error) {
        console.error(`Error closing ${operation} stream:`, error);
      }
    }
    
    this._changeStreams.clear();
    
  // Remove all event listeners
    this.removeAllListeners();
  }

  // Debug method - view status of streams
  getStreamsStatus() {
    const status = [];
    for (const [operation, stream] of this._changeStreams) {
      status.push({
        operation,
        closed: stream.closed || false,
        collection: this._cursorDescription.collectionName,
      });
    }
    return status;
  }
}
