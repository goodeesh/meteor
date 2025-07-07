import { Meteor } from 'meteor/meteor';
import { LocalCollection } from 'meteor/minimongo';
import { Random } from 'meteor/random';
import { EventEmitter } from 'events';

const SUPPORTED_OPERATIONS = ['insert', 'update', 'replace', 'delete'];

// Helper function for structured logging throughout the change streams flow
const logChangeStreamFlow = (stage, data) => {
  if(!process.env.DEBUG) return;
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    stage,
    ...data
  };
  
  // Use different colors/icons for different stages
  const stageColors = {
    'CHANGE_STREAM_CREATED': '🔷',
    'CHANGE_STREAM_EVENT_RECEIVED': '🔵',
    'CHANGE_STREAM_EVENT_PROCESSING': '🟡',
    'DOCUMENT_MATCHING': '🟢',
    'INITIAL_ADDS_START': '🚀',
    'INITIAL_ADDS_COMPLETE': '✅',
    'MULTIPLEXER_CALLBACK': '⚡',
    'STREAM_RESTART': '🔄',
    'STREAM_ERROR': '❌',
    'STREAM_CLOSED': '🔴',
    'DRIVER_STOPPED': '🛑',
    'PERFORMANCE_METRIC': '⏱️'
  };
  
  const icon = stageColors[stage] || '📋';
  console.log(`${icon} [ChangeStreamFlow] ${stage}:`, JSON.stringify(logEntry, null, 2));
};

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
    
    // Log driver creation
    logChangeStreamFlow('CHANGE_STREAM_CREATED', {
      driverId: this._id,
      collectionName: this._cursorDescription.collectionName,
      selector: this._cursorDescription.selector,
      options: this._cursorDescription.options,
      ordered: this._ordered,
      hasProjection: !!projection,
      hasMatcher: !!this._matcher,
      functionName: 'constructor'
    });
    
    this._setupEventHandlers();
    
    this._startWatching();
  }

  _setupEventHandlers() {
  // Event handlers that process events directly
    this.on('insert', (data) => this._processEventDirect('insert', data));
    this.on('update', (data) => this._processEventDirect('update', data));
    this.on('replace', (data) => this._processEventDirect('replace', data));
    this.on('delete', (data) => this._processEventDirect('delete', data));
  }

  _processEventDirect(operation, data) {
    // Log event received
    logChangeStreamFlow('CHANGE_STREAM_EVENT_RECEIVED', {
      driverId: this._id,
      collectionName: this._cursorDescription.collectionName,
      operation,
      docId: data.id,
      hasFullDocument: !!data.fullDocument,
      hasBeforeDocument: !!data.fullDocumentBeforeChange,
      functionName: '_processEventDirect'
    });
    
    // Process event immediately (like oplog driver)
    logChangeStreamFlow('CHANGE_STREAM_EVENT_PROCESSING', {
      driverId: this._id,
      docId: data.id,
      operation,
      action: 'IMMEDIATE_PROCESSING',
      functionName: '_processEventDirect'
    });
    
    this._handleEvent(operation, data);
  }

  _handleEvent(operation, data) {
    try {
      // Log event handling
      logChangeStreamFlow('CHANGE_STREAM_EVENT_PROCESSING', {
        driverId: this._id,
        collectionName: this._cursorDescription.collectionName,
        docId: data.id,
        operation,
        action: 'DISPATCHING_TO_HANDLER',
        handlerFunction: `_handle${operation.charAt(0).toUpperCase()}${operation.slice(1)}`,
        functionName: '_handleEvent'
      });
      
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
      logChangeStreamFlow('STREAM_ERROR', {
        driverId: this._id,
        collectionName: this._cursorDescription.collectionName,
        docId: data.id,
        operation,
        error: error.message,
        stack: error.stack,
        functionName: '_handleEvent'
      });
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
      
      // Log stream error
      logChangeStreamFlow('STREAM_ERROR', {
        driverId: self._id,
        collectionName: self._cursorDescription.collectionName,
        operation,
        error: error.message,
        stack: error.stack,
        action: 'SCHEDULING_RESTART',
        functionName: '_setupStreamHandlers'
      });
      
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
        // Log stream closure
        logChangeStreamFlow('STREAM_CLOSED', {
          driverId: self._id,
          collectionName: self._cursorDescription.collectionName,
          operation,
          reason: 'UNEXPECTED_CLOSE',
          action: 'SCHEDULING_RESTART',
          functionName: '_setupStreamHandlers'
        });
        
        console.warn(`ChangeStream ${operation} unexpectedly closed for ${self._cursorDescription.collectionName}`);
        setTimeout(() => {
          if (!self._stopped) {
            self._restartOperationStream(operation);
          }
        }, 1000);
      } else {
        // Log expected closure
        logChangeStreamFlow('STREAM_CLOSED', {
          driverId: self._id,
          collectionName: self._cursorDescription.collectionName,
          operation,
          reason: 'DRIVER_STOPPED',
          action: 'NONE',
          functionName: '_setupStreamHandlers'
        });
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
    // Log restart attempt
    logChangeStreamFlow('STREAM_RESTART', {
      driverId: this._id,
      collectionName: this._cursorDescription.collectionName,
      operation,
      action: 'RESTART_ATTEMPT',
      functionName: '_restartOperationStream'
    });
    
    try {
      const stream = this._changeStreams.get(operation);
      if (stream) {
        await stream.close();
        
        logChangeStreamFlow('STREAM_RESTART', {
          driverId: this._id,
          collectionName: this._cursorDescription.collectionName,
          operation,
          action: 'OLD_STREAM_CLOSED',
          functionName: '_restartOperationStream'
        });
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
      
      // Log successful restart
      logChangeStreamFlow('STREAM_RESTART', {
        driverId: this._id,
        collectionName: this._cursorDescription.collectionName,
        operation,
        action: 'RESTART_SUCCESS',
        pipeline,
        options: changeStreamOptions,
        functionName: '_restartOperationStream'
      });
      
      console.log(`🔄 ChangeStream ${operation} successfully restarted for ${this._cursorDescription.collectionName}`);
    } catch (error) {
      // Log restart failure
      logChangeStreamFlow('STREAM_ERROR', {
        driverId: this._id,
        collectionName: this._cursorDescription.collectionName,
        operation,
        error: error.message,
        stack: error.stack,
        context: 'RESTART_FAILURE',
        functionName: '_restartOperationStream'
      });
      
      console.error(`Failed to restart ${operation} ChangeStream:`, error);
    }
  }

  async _sendInitialAdds(collection) {
    if (this._stopped) return;
    
    // Log initial adds start
    logChangeStreamFlow('INITIAL_ADDS_START', {
      driverId: this._id,
      collectionName: this._cursorDescription.collectionName,
      selector: this._cursorDescription.selector || {},
      options: this._cursorDescription.options,
      functionName: '_sendInitialAdds'
    });
    
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
      
      let addedCount = 0;
      let skippedCount = 0;
      
      // Send 'added' for each existing document that matches our matcher
      for (const doc of docs) {
        if (this._stopped) return;
        
        let matches = false;
        if (this._matcher && this._matcher.documentMatches(doc).result) {
          matches = true;
          const projectedDoc = this._projectionFn ? this._projectionFn(doc) : doc;
          this._multiplexer.added(doc._id, projectedDoc);
          addedCount++;
          
          // Log document matching and multiplexer callback
          logChangeStreamFlow('DOCUMENT_MATCHING', {
            driverId: this._id,
            collectionName: this._cursorDescription.collectionName,
            docId: doc._id,
            action: 'INITIAL_ADD_MATCHED',
            matches: true,
            functionName: '_sendInitialAdds'
          });
          
          logChangeStreamFlow('MULTIPLEXER_CALLBACK', {
            driverId: this._id,
            collectionName: this._cursorDescription.collectionName,
            docId: doc._id,
            callback: 'added',
            context: 'INITIAL_ADDS',
            functionName: '_sendInitialAdds'
          });
        } else if (!this._matcher) {
          // If no matcher, include all documents
          matches = true;
          const projectedDoc = this._projectionFn ? this._projectionFn(doc) : doc;
          this._multiplexer.added(doc._id, projectedDoc);
          addedCount++;
          
          logChangeStreamFlow('MULTIPLEXER_CALLBACK', {
            driverId: this._id,
            collectionName: this._cursorDescription.collectionName,
            docId: doc._id,
            callback: 'added',
            context: 'INITIAL_ADDS_NO_MATCHER',
            functionName: '_sendInitialAdds'
          });
        } else {
          skippedCount++;
          logChangeStreamFlow('DOCUMENT_MATCHING', {
            driverId: this._id,
            collectionName: this._cursorDescription.collectionName,
            docId: doc._id,
            action: 'INITIAL_ADD_SKIPPED',
            matches: false,
            functionName: '_sendInitialAdds'
          });
        }
      }
      
      // Mark that initial adds are complete
      if (!this._multiplexer._ready()) {
        this._multiplexer.ready();
        logChangeStreamFlow('INITIAL_ADDS_COMPLETE', {
          driverId: this._id,
          collectionName: this._cursorDescription.collectionName,
          totalDocuments: docs.length,
          addedCount,
          skippedCount,
          multiplexerReady: true,
          functionName: '_sendInitialAdds'
        });
        console.log(`ChangeStream: Initial adds complete for ${this._cursorDescription.collectionName} (${docs.length} docs)`);
      } else {
        logChangeStreamFlow('INITIAL_ADDS_COMPLETE', {
          driverId: this._id,
          collectionName: this._cursorDescription.collectionName,
          totalDocuments: docs.length,
          addedCount,
          skippedCount,
          multiplexerReady: false,
          warning: 'Multiplexer already ready',
          functionName: '_sendInitialAdds'
        });
        console.warn(`ChangeStream: Multiplexer already ready for ${this._cursorDescription.collectionName}`);
      }
    } catch (error) {
      logChangeStreamFlow('STREAM_ERROR', {
        driverId: this._id,
        collectionName: this._cursorDescription.collectionName,
        error: error.message,
        stack: error.stack,
        context: 'INITIAL_ADDS',
        functionName: '_sendInitialAdds'
      });
      console.error('Error sending initial adds for ChangeStream:', error);
      throw error;
    }
  }

  // Event handlers

  _handleInsert(id, doc) {
    // Apply projection and check if document matches our criteria
    const matches = this._matcher ? this._matcher.documentMatches(doc).result : true;
    
    // Log document matching decision
    logChangeStreamFlow('DOCUMENT_MATCHING', {
      driverId: this._id,
      collectionName: this._cursorDescription.collectionName,
      docId: id,
      operation: 'INSERT',
      matches,
      hasMatcher: !!this._matcher,
      functionName: '_handleInsert'
    });
    
    if (matches) {
      const projectedDoc = this._projectionFn ? this._projectionFn(doc) : doc;
      
      // Measure Change Stream notification latency
      if (doc && doc.createdAt) {
        const now = Date.now();
        const insertedAt = new Date(doc.createdAt).getTime();
        const latencyMs = now - insertedAt;
        
        logChangeStreamFlow('PERFORMANCE_METRIC', {
          driverId: this._id,
          collectionName: this._cursorDescription.collectionName,
          docId: id,
          operation: 'INSERT',
          latencyMs,
          timestamp: new Date(insertedAt).toISOString(),
          functionName: '_handleInsert'
        });
        
        console.log(`⏱️ ChangeStream INSERT latency: ${latencyMs} ms (ID: ${id})`);
      }
      
      this._multiplexer.added(id, projectedDoc);
      
      // Log multiplexer callback
      logChangeStreamFlow('MULTIPLEXER_CALLBACK', {
        driverId: this._id,
        collectionName: this._cursorDescription.collectionName,
        docId: id,
        callback: 'added',
        operation: 'INSERT',
        hasProjection: !!this._projectionFn,
        functionName: '_handleInsert'
      });
    }
  }

  _handleUpdate(id, docAfter, docBefore) {
    const matchesAfter = this._matcher ? this._matcher.documentMatches(docAfter || {}).result : true;
    const matchesBefore = (docBefore && this._matcher) ? this._matcher.documentMatches(docBefore).result : false;
    
    // Log document matching decision
    logChangeStreamFlow('DOCUMENT_MATCHING', {
      driverId: this._id,
      collectionName: this._cursorDescription.collectionName,
      docId: id,
      operation: 'UPDATE',
      matchesAfter,
      matchesBefore,
      hasDocAfter: !!docAfter,
      hasDocBefore: !!docBefore,
      hasMatcher: !!this._matcher,
      functionName: '_handleUpdate'
    });
    
    if (matchesAfter && matchesBefore) {
      // Document matched before and after - it's a change
      const projectedDoc = this._projectionFn ? this._projectionFn(docAfter) : docAfter;
      this._multiplexer.changed(id, projectedDoc);
      
      // Log multiplexer callback
      logChangeStreamFlow('MULTIPLEXER_CALLBACK', {
        driverId: this._id,
        collectionName: this._cursorDescription.collectionName,
        docId: id,
        callback: 'changed',
        operation: 'UPDATE',
        scenario: 'MATCHES_BEFORE_AND_AFTER',
        functionName: '_handleUpdate'
      });
    } else if (matchesAfter && !matchesBefore) {
      // Document didn't match before but matches now - it's an add
      const projectedDoc = this._projectionFn ? this._projectionFn(docAfter) : docAfter;
      this._multiplexer.added(id, projectedDoc);
      
      // Log multiplexer callback
      logChangeStreamFlow('MULTIPLEXER_CALLBACK', {
        driverId: this._id,
        collectionName: this._cursorDescription.collectionName,
        docId: id,
        callback: 'added',
        operation: 'UPDATE',
        scenario: 'NOW_MATCHES_AFTER_UPDATE',
        functionName: '_handleUpdate'
      });
    } else if (!matchesAfter && matchesBefore) {
      // Document matched before but doesn't match now - it's a remove
      this._multiplexer.removed(id);
      
      // Log multiplexer callback
      logChangeStreamFlow('MULTIPLEXER_CALLBACK', {
        driverId: this._id,
        collectionName: this._cursorDescription.collectionName,
        docId: id,
        callback: 'removed',
        operation: 'UPDATE',
        scenario: 'NO_LONGER_MATCHES_AFTER_UPDATE',
        functionName: '_handleUpdate'
      });
    } else {
      // If neither matches before nor after, ignore
      logChangeStreamFlow('DOCUMENT_MATCHING', {
        driverId: this._id,
        collectionName: this._cursorDescription.collectionName,
        docId: id,
        operation: 'UPDATE',
        action: 'IGNORED',
        reason: 'Document does not match before or after update',
        functionName: '_handleUpdate'
      });
    }
  }

  _handleReplace(id, docAfter, docBefore) {
  // Handle replace similar to update
    this._handleUpdate(id, docAfter, docBefore);
  }

  _handleDelete(id, docBefore) {
    // For deletes, we only care if the document was in our result set before
    const matchesBefore = (docBefore && this._matcher) ? this._matcher.documentMatches(docBefore).result : false;
    
    // Log document matching decision
    logChangeStreamFlow('DOCUMENT_MATCHING', {
      driverId: this._id,
      collectionName: this._cursorDescription.collectionName,
      docId: id,
      operation: 'DELETE',
      matchesBefore,
      hasDocBefore: !!docBefore,
      hasMatcher: !!this._matcher,
      functionName: '_handleDelete'
    });
    
    if (docBefore && this._matcher && matchesBefore) {
      this._multiplexer.removed(id);
      
      // Log multiplexer callback
      logChangeStreamFlow('MULTIPLEXER_CALLBACK', {
        driverId: this._id,
        collectionName: this._cursorDescription.collectionName,
        docId: id,
        callback: 'removed',
        operation: 'DELETE',
        scenario: 'MATCHED_BEFORE_DELETE',
        functionName: '_handleDelete'
      });
    } else if (!docBefore || !this._matcher) {
      // If we don't have the before document or no matcher, assume it might have been in our set
      // This is a limitation - we might send unnecessary removes
      this._multiplexer.removed(id);
      
      // Log multiplexer callback
      logChangeStreamFlow('MULTIPLEXER_CALLBACK', {
        driverId: this._id,
        collectionName: this._cursorDescription.collectionName,
        docId: id,
        callback: 'removed',
        operation: 'DELETE',
        scenario: 'CONSERVATIVE_REMOVE',
        reason: 'No before document or no matcher - assuming document was in result set',
        functionName: '_handleDelete'
      });
    } else {
      // Document didn't match before, so no need to remove
      logChangeStreamFlow('DOCUMENT_MATCHING', {
        driverId: this._id,
        collectionName: this._cursorDescription.collectionName,
        docId: id,
        operation: 'DELETE',
        action: 'IGNORED',
        reason: 'Document did not match before delete',
        functionName: '_handleDelete'
      });
    }
  }

  async stop() {
    if (this._stopped) return;
    
    // Log driver stopping
    logChangeStreamFlow('DRIVER_STOPPED', {
      driverId: this._id,
      collectionName: this._cursorDescription.collectionName,
      action: 'STOP_INITIATED',
      activeStreams: Array.from(this._changeStreams.keys()),
      functionName: 'stop'
    });
    
    this._stopped = true;
    
    // Close all change streams
    for (const [operation, stream] of this._changeStreams) {
      try {
        await stream.close();
        
        // Log individual stream closure
        logChangeStreamFlow('STREAM_CLOSED', {
          driverId: this._id,
          collectionName: this._cursorDescription.collectionName,
          operation,
          reason: 'DRIVER_STOP',
          action: 'STREAM_CLOSED_SUCCESS',
          functionName: 'stop'
        });
      } catch (error) {
        // Log stream closure error
        logChangeStreamFlow('STREAM_ERROR', {
          driverId: this._id,
          collectionName: this._cursorDescription.collectionName,
          operation,
          error: error.message,
          context: 'STREAM_CLOSURE_ERROR',
          functionName: 'stop'
        });
        console.error(`Error closing ${operation} stream:`, error);
      }
    }
    
    this._changeStreams.clear();
    
    // Remove all event listeners
    this.removeAllListeners();
    
    // Log driver stopped
    logChangeStreamFlow('DRIVER_STOPPED', {
      driverId: this._id,
      collectionName: this._cursorDescription.collectionName,
      action: 'STOP_COMPLETE',
      streamsCleared: true,
      listenersRemoved: true,
      functionName: 'stop'
    });
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
