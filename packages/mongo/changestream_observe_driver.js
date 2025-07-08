import { Meteor } from 'meteor/meteor';
import { LocalCollection } from 'meteor/minimongo';
import { Random } from 'meteor/random';

const SUPPORTED_OPERATIONS = ['insert', 'update', 'replace', 'delete'];

export class ChangeStreamObserveDriver {
  constructor(options) {
    const self = this;
    
    
    this._usesChangeStreams = true;
    this._cursorDescription = options.cursorDescription;
    this._mongoHandle = options.mongoHandle;
    this._multiplexer = options.multiplexer;
    this._ordered = options.ordered;
    this._changeStream = null;
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
    
    this._startWatching();
  }

  async _startWatching() {
    const self = this;
    
    if (this._stopped) return;
    
    try {
      const collection = this._mongoHandle.rawCollection(this._cursorDescription.collectionName);
      
      // First, get all existing documents that match our selector
      await this._sendInitialAdds(collection);
      
      // Then start watching for changes
      const pipeline = this._buildPipeline();
      
      // Create change stream with appropriate options
      const changeStreamOptions = {
        fullDocument: 'updateLookup',
        fullDocumentBeforeChange: 'whenAvailable'
      };
      
      this._changeStream = collection.watch(pipeline, changeStreamOptions);
      
      
      // Handle change events
      this._changeStream.on('change', Meteor.bindEnvironment((change) => {
        if (self._stopped) return;
        self._handleChange(change);
      }));
      
      // Handle errors and reconnection
      this._changeStream.on('error', Meteor.bindEnvironment((error) => {
        if (self._stopped) return;
        console.error('ChangeStream error:', error);
        // Attempt to restart after a delay
        setTimeout(() => {
          if (!self._stopped) {
            self._restartChangeStream();
          }
        }, 1000);
      }));
      
      this._changeStream.on('close', Meteor.bindEnvironment(() => {
        if (!self._stopped) {
          // Unexpected close, attempt restart
          setTimeout(() => {
            if (!self._stopped) {
              self._restartChangeStream();
            }
          }, 1000);
        }
      }));
      
    } catch (error) {
      console.error('Failed to start ChangeStream:', error);
      throw error;
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
      this._multiplexer.ready();
    } catch (error) {
      console.error('Error sending initial adds for ChangeStream:', error);
      throw error;
    }
  }

  async _restartChangeStream() {
    try {
      if (this._changeStream) {
        await this._changeStream.close();
      }
      await this._startWatching();
    } catch (error) {
      console.error('Failed to restart ChangeStream:', error);
    }
  }

  _buildPipeline() {
    // For now, use a simple pipeline that watches all operations
    // We'll filter using our matcher in _handleChange
    const selector = this._cursorDescription.selector;
    
    if (!selector || Object.keys(selector).length === 0) {
      // No selector, watch all changes
      return [];
    }
    
    // Simple pipeline that just filters by operation type
    // More complex selector filtering will be done in _handleChange
    return [
      {
        $match: {
          operationType: { $in: ['insert', 'update', 'replace', 'delete'] }
        }
      }
    ];
  }

  _handleChange(change) {
    if (this._stopped) return;
    
    const { operationType, documentKey, fullDocument, fullDocumentBeforeChange } = change;
    
    if (!SUPPORTED_OPERATIONS.includes(operationType)) {
      return; // Ignore unsupported operations
    }
    
    const id = documentKey._id;
    
    try {
      switch (operationType) {
        case 'insert':
          this._handleInsert(id, fullDocument);
          break;
        case 'update':
          this._handleUpdate(id, fullDocument, fullDocumentBeforeChange);
          break;
        case 'replace':
          this._handleReplace(id, fullDocument, fullDocumentBeforeChange);
          break;
        case 'delete':
          this._handleDelete(id, fullDocumentBeforeChange);
          break;
      }
    } catch (error) {
      console.error('Error handling change stream event:', error);
    }
  }

  _handleInsert(id, doc) {
    // Apply projection and check if document matches our criteria
    const matches = this._matcher ? this._matcher.documentMatches(doc).result : true;
    if (matches) {
      const projectedDoc = this._projectionFn ? this._projectionFn(doc) : doc;
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
    
    if (this._changeStream) {
      try {
        await this._changeStream.close();
      } catch (error) {
        // Ignore errors when closing
      }
      this._changeStream = null;
    }
  }
}
