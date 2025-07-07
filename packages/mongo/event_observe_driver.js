import { Meteor } from 'meteor/meteor';
import { LocalCollection } from 'meteor/minimongo';
import { Random } from 'meteor/random';
import { EventEmitter } from 'events';

// Sistema de eventos global dividido por tipo de operação para evitar backpressure
const DatabaseInsertEvents = new EventEmitter();
const DatabaseUpdateEvents = new EventEmitter();
const DatabaseDeleteEvents = new EventEmitter();

// Configurar para não ter limite de listeners
DatabaseInsertEvents.setMaxListeners(0);
DatabaseUpdateEvents.setMaxListeners(0);
DatabaseDeleteEvents.setMaxListeners(0);

// Mapa para acessar os eventos por tipo
const DatabaseEventsByType = {
  insert: DatabaseInsertEvents,
  update: DatabaseUpdateEvents,
  replace: DatabaseUpdateEvents, // Replace uses the same channel as update
// Global event system split by operation type to avoid backpressure
// Set to have no limit of listeners
// Map to access events by type
  delete: DatabaseDeleteEvents
};

// Exportar para uso em outras partes do sistema
// Export for use in other parts of the system
export { DatabaseInsertEvents, DatabaseUpdateEvents, DatabaseDeleteEvents, DatabaseEventsByType };

const SUPPORTED_OPERATIONS = ['insert', 'update', 'replace', 'delete'];

export class EventObserveDriver extends EventEmitter {
  constructor(options) {
    super();
    

    
    this._usesEvents = true;
    this._cursorDescription = options.cursorDescription;
    this._mongoHandle = options.mongoHandle;
    this._multiplexer = options.multiplexer;
    this._ordered = options.ordered;
    this._stopped = false;
    
    // Use the matcher passed from mongo_connection.js
    this._matcher = options.matcher;
    
  // Fallback: create matcher if not provided
    if (!this._matcher) {
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
    
  // Event listeners for database operations on our collection
    this._eventListeners = new Map();
    
    // Setup event handlers - processamento direto
// Setup event handlers - direct processing
    this._setupEventHandlers();
    

    this._startWatching();
  }

  _setupEventHandlers() {
    // Event handlers que processam eventos diretamente (sem batch)
// Event handlers that process events directly (no batch)
    this.on('insert', (data) => this._processEventDirect('insert', data));
    this.on('update', (data) => this._processEventDirect('update', data));
    this.on('replace', (data) => this._processEventDirect('replace', data));
    this.on('delete', (data) => this._processEventDirect('delete', data));
  }

  _processEventDirect(operation, data) {
    // Processar evento imediatamente (como oplog driver)
// Process event immediately (like oplog driver)
    this._handleEvent(operation, data);
  }

  _handleEvent(operation, data) {
    try {
      switch (operation) {
        case 'insert':
          this._handleInsert(data.id, data.document);
          break;
        case 'update':
          this._handleUpdate(data.id, data.document, data.previousDocument);
          break;
        case 'replace':
          this._handleReplace(data.id, data.document, data.previousDocument);
          break;
        case 'delete':
          this._handleDelete(data.id, data.previousDocument);
          break;
      }
    } catch (error) {
      console.error(`Error processing ${operation} event:`, error);
    }
  }

  async _startWatching() {
    if (this._stopped) return;
    
    try {
      const collection = this._mongoHandle.rawCollection(this._cursorDescription.collectionName);
      
      // Só envia os adds iniciais se o multiplexer ainda não estiver pronto
// Only send initial adds if the multiplexer is not ready yet
      if (!this._multiplexer._ready()) {
        await this._sendInitialAdds(collection);
      }
      
      // Configurar listeners para eventos de banco específicos da nossa collection
// Set up listeners for database events specific to our collection
      this._setupDatabaseEventListeners();
      
      console.log(`🎯 EventDriver: Watching for events on collection ${this._cursorDescription.collectionName}`);
      
    } catch (error) {
      console.error('Failed to start EventObserveDriver:', error);
      throw error;
    }
  }

  _setupDatabaseEventListeners() {
    const collectionName = this._cursorDescription.collectionName;
    
    // Configurar listeners para cada tipo de operação usando canais separados
// Set up listeners for each operation type using separate channels
    for (const operation of SUPPORTED_OPERATIONS) {
      const eventName = `${collectionName}:${operation}`;
      const eventEmitter = DatabaseEventsByType[operation];
      
      if (!eventEmitter) {
        console.warn(`No event emitter found for operation: ${operation}`);
        continue;
      }
      
      const listener = Meteor.bindEnvironment((eventData) => {
        if (this._stopped) return;
        

        
        // Emitir evento interno específico para esta operação
        this.emit(operation, eventData);
      });
      
      // Registrar listener no canal específico da operação
// Register listener on the specific channel for the operation
// Emit internal event specific to this operation
      eventEmitter.on(eventName, listener);
      this._eventListeners.set(eventName, { listener, emitter: eventEmitter });
      

    }
  }

  async _sendInitialAdds(collection) {
    if (this._stopped) return;
    
    try {
      // Build the same selector and options that the cursor would use
// Build the same selector and options that the cursor would use
      const selector = this._cursorDescription.selector || {};
      const options = { ...this._cursorDescription.options };
      
      // Remove some options that don't apply to find()
// Remove some options that don't apply to find()
      delete options.tailable;
      delete options.oplogReplay;
      
      console.log(`EventDriver: Sending initial adds for collection ${this._cursorDescription.collectionName}`);
      console.log(`EventDriver: Selector:`, selector);
      
      // Find all existing documents
// Find all existing documents
      const cursor = collection.find(selector, options);
      const docs = await cursor.toArray();
      
      // Send 'added' for each existing document that matches our matcher
// Send 'added' for each existing document that matches our matcher
      for (const doc of docs) {
        if (this._stopped) return;
        
        if (this._matcher && this._matcher.documentMatches(doc).result) {
          const projectedDoc = this._projectionFn ? this._projectionFn(doc) : doc;
          this._multiplexer.added(doc._id, projectedDoc);
        } else if (!this._matcher) {
          // If no matcher, include all documents
// If no matcher, include all documents
          const projectedDoc = this._projectionFn ? this._projectionFn(doc) : doc;
          this._multiplexer.added(doc._id, projectedDoc);
        }
      }
      
      // Mark that initial adds are complete
// Mark that initial adds are complete
      if (!this._multiplexer._ready()) {
        this._multiplexer.ready();
        console.log(`EventDriver: Initial adds complete for ${this._cursorDescription.collectionName} (${docs.length} docs)`);
      } else {
        console.warn(`EventDriver: Multiplexer already ready for ${this._cursorDescription.collectionName}`);
      }
      
    } catch (error) {
      console.error('Error sending initial adds for EventDriver:', error);
      throw error;
    }
  }

  // Event handlers

  _handleInsert(id, doc) {
    // Apply projection and check if document matches our criteria
    const matches = this._matcher ? this._matcher.documentMatches(doc).result : true;

    
    if (matches) {
      const projectedDoc = this._projectionFn ? this._projectionFn(doc) : doc;
      // Medir latência de notificação do Event System
// Measure notification latency of the Event System
// Apply projection and check if document matches our criteria
      if (doc.createdAt) {
        // createdAt, receivedAt, emitedAt
        const now = Date.now();
        const insertedAt = new Date(doc.createdAt).getTime();
        const receivedAt = new Date(doc.docReceivedAt).getTime();
        const emitedAt = new Date(doc.emittedAt).getTime();
        const latencyMs = now - insertedAt;
        const latencyReceivedMs = now - receivedAt;
        const latencyEmitedMs = now - emitedAt;
        console.log(`⏱️ EventDriver INSERT latency: ${latencyMs} ms (ID: ${id})`);
        console.log(`⏱️ EventDriver INSERT latency received: ${latencyReceivedMs} ms (ID: ${id})`);
        console.log(`⏱️ EventDriver INSERT latency emited: ${latencyEmitedMs} ms (ID: ${id})`);
        console.log(`--------------------------------`);

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
    
    // Remover todos os event listeners dos canais específicos
// Remove all event listeners from the specific channels
    for (const [eventName, listenerInfo] of this._eventListeners) {
      const { listener, emitter } = listenerInfo;
      emitter.removeListener(eventName, listener);

    }
    
    this._eventListeners.clear();
    
    // Remover todos os event listeners locais
// Remove all local event listeners
    this.removeAllListeners();
    
    console.log(`🗑️ EventDriver: Stopped watching collection ${this._cursorDescription.collectionName}`);
  }

  // Método para debug - ver status dos listeners
// Debug method - view status of listeners
  getListenersStatus() {
    const status = [];
    for (const [eventName, listenerInfo] of this._eventListeners) {
      const operation = eventName.split(':')[1];
      
      status.push({
        eventName,
        operation,
        collection: this._cursorDescription.collectionName,
        listening: true,
        directProcessing: true // No batch processing
      });
    }
    return status;
  }
}

// Funções utilitárias para emitir eventos de banco de dados usando canais separados
// Utility functions to emit database events using separate channels
export const emitDatabaseEvent = (collectionName, operation, data) => {
  const eventName = `${collectionName}:${operation}`;
  const eventEmitter = DatabaseEventsByType[operation];
  
  if (!eventEmitter) {
    console.warn(`No event emitter found for operation: ${operation}`);
    return;
  }
  
  
  
  // Use setImmediate to not block the main operation
  setImmediate(() => {
    eventEmitter.emit(eventName, data);
  });
};

// Função para verificar se o driver suporta um cursor
// Function to check if the driver supports a cursor
EventObserveDriver.cursorSupported = function (cursorDescription, matcher) {
  // Este driver funciona com qualquer cursor, mas pode ser limitado por configuração
// This driver works with any cursor, but can be limited by configuration
  const options = cursorDescription.options;

  // Did the user say no explicitly?
// Did the user say no explicitly?
  if (options.disableEvents || options._disableEvents)
    return false;

  // Suporta todas as operações básicas
// Supports all basic operations
  // skip is supported since we're not tailing any log
// skip is supported since we're not tailing any log
  // limit is supported
// limit is supported
  
  // If a fields projection option is given check if it is supported by
// If a fields projection option is given check if it is supported by
  // minimongo (some operators are not supported).
// minimongo (some operators are not supported).
  const fields = options.fields || options.projection;
  if (fields) {
    try {
      LocalCollection._checkSupportedProjection(fields);
    } catch (e) {
      if (e.name === "MinimongoError") {
        return false;
      } else {
        throw e;
      }
    }
  }

  // This driver supports most selectors, including $where and $near
// This driver supports most selectors, including $where and $near
  // since we're not constrained by oplog limitations
// since we're not constrained by oplog limitations
  return true;
}; 