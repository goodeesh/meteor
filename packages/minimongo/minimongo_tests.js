Tinytest.add('minimongo - wrapTransform', test => {
  const wrap = LocalCollection.wrapTransform;

  // Transforming no function gives falsey.
  test.isFalse(wrap(undefined));
  test.isFalse(wrap(null));

  // It's OK if you don't change the ID.
  const validTransform = doc => {
    delete doc.x;
    doc.y = 42;
    doc.z = () => 43;
    return doc;
  };
  const transformed = wrap(validTransform)({_id: 'asdf', x: 54});
  test.equal(Object.keys(transformed), ['_id', 'y', 'z']);
  test.equal(transformed.y, 42);
  test.equal(transformed.z(), 43);

  // Ensure that ObjectIDs work (even if the _ids in question are not ===-equal)
  const oid1 = new MongoID.ObjectID();
  const oid2 = new MongoID.ObjectID(oid1.toHexString());
  test.equal(wrap(() => ({
    _id: oid2,
  }))({_id: oid1}),
  {_id: oid2});

  // transform functions must return objects
  const invalidObjects = [
    'asdf', new MongoID.ObjectID(), false, null, true,
    27, [123], /adsf/, new Date, () => {}, undefined,
  ];
  invalidObjects.forEach(invalidObject => {
    const wrapped = wrap(() => invalidObject);
    test.throws(() => {
      wrapped({_id: 'asdf'});
    });
  }, /transform must return object/);

  // transform functions may not change _ids
  const wrapped = wrap(doc => { doc._id = 'x'; return doc; });
  test.throws(() => {
    wrapped({_id: 'y'});
  }, /can't have different _id/);

  // transform functions may remove _ids
  test.equal({_id: 'a', x: 2},
    wrap(d => {delete d._id; return d;})({_id: 'a', x: 2}));

  // test that wrapped transform functions are nonreactive
  const unwrapped = doc => {
    test.isFalse(Tracker.active);
    return doc;
  };
  const handle = Tracker.autorun(() => {
    test.isTrue(Tracker.active);
    wrap(unwrapped)({_id: 'xxx'});
  });
  handle.stop();
});

Tinytest.add('minimongo - $setField operator', test => {
  const coll = new LocalCollection();
  
  // Insert a test document
  const id = coll.insert({name: 'Alice', age: 25});
  
  // Test $setField with dot notation field name
  coll.update(id, {
    $setField: {
      field: 'user.email',
      value: 'alice@example.com'
    }
  });
  
  const doc = coll.findOne(id);
  test.equal(doc['user.email'], 'alice@example.com');
  test.equal(doc.name, 'Alice');
  test.equal(doc.age, 25);
  
  // Test $setField with special characters in field name
  coll.update(id, {
    $setField: {
      field: 'field.with.dots',
      value: 'special value'
    }
  });
  
  const updatedDoc = coll.findOne(id);
  test.equal(updatedDoc['field.with.dots'], 'special value');
  
  // Test $setField error cases
  test.throws(() => {
    coll.update(id, {
      $setField: 'invalid'
    });
  }, /requires an object with field and value/);
  
  test.throws(() => {
    coll.update(id, {
      $setField: {
        field: 'test'
        // missing value
      }
    });
  }, /requires both field and value properties/);
  
  test.throws(() => {
    coll.update(id, {
      $setField: {
        field: 123,
        value: 'test'
      }
    });
  }, /field must be a string/);
});

Tinytest.add('minimongo - $getField projection', test => {
  const coll = new LocalCollection();
  
  // Insert documents with dot notation field names
  const id1 = coll.insert({
    name: 'Alice',
    'user.email': 'alice@example.com',
    'config.theme': 'dark',
    age: 25
  });
  
  const id2 = coll.insert({
    name: 'Bob',
    'user.email': 'bob@example.com',
    'config.theme': 'light',
    age: 30
  });
  
  // Test $getField projection
  const results = coll.find({}, {
    fields: {
      name: 1,
      email: { $getField: 'user.email' },
      theme: { $getField: 'config.theme' }
    }
  }).fetch();
  
  test.equal(results.length, 2);
  
  const alice = results.find(doc => doc.name === 'Alice');
  test.equal(alice.email, 'alice@example.com');
  test.equal(alice.theme, 'dark');
  test.isUndefined(alice['user.email']);
  test.isUndefined(alice['config.theme']);
  test.isUndefined(alice.age);
  
  const bob = results.find(doc => doc.name === 'Bob');
  test.equal(bob.email, 'bob@example.com');
  test.equal(bob.theme, 'light');
  
  // Test $getField with non-existent field
  const resultsWithMissing = coll.find({}, {
    fields: {
      name: 1,
      missing: { $getField: 'non.existent.field' }
    }
  }).fetch();
  
  test.equal(resultsWithMissing.length, 2);
  test.isUndefined(resultsWithMissing[0].missing);
  test.isUndefined(resultsWithMissing[1].missing);
  
  // Test $getField error case
  test.throws(() => {
    coll.find({}, {
      fields: {
        invalid: { $getField: 123 }
      }
    }).fetch();
  }, /requires a string field name/);
});

Tinytest.add('minimongo - dots allowed in field names', test => {
  const coll = new LocalCollection();
  
  // Test that dots are now allowed in field names
  const docWithDots = {
    'field.with.dots': 'value1',
    'another.dotted.field': 'value2',
    'user.profile.name': 'Alice',
    normalField: 'normal'
  };
  
  // This should not throw an error
  const id = coll.insert(docWithDots);
  test.isTrue(id);
  
  // Verify the document was inserted correctly
  const retrieved = coll.findOne(id);
  test.equal(retrieved['field.with.dots'], 'value1');
  test.equal(retrieved['another.dotted.field'], 'value2');
  test.equal(retrieved['user.profile.name'], 'Alice');
  test.equal(retrieved.normalField, 'normal');
  
  // Test updating documents with dotted field names
  coll.update(id, {
    $set: {
      'new.dotted.field': 'new value',
      'field.with.dots': 'updated value'
    }
  });
  
  const updated = coll.findOne(id);
  test.equal(updated['new.dotted.field'], 'new value');
  test.equal(updated['field.with.dots'], 'updated value');
  
  // Test that $ and null bytes are still forbidden
  test.throws(() => {
    coll.insert({
      '$invalidField': 'value'
    });
  }, /must not start with '\$'/);
  
  test.throws(() => {
    coll.insert({
      'field\0withNull': 'value'
    });
  }, /must not contain null bytes/);
});

Tinytest.add('minimongo - complex dot notation scenarios', test => {
  const coll = new LocalCollection();
  
  // Insert document with various dotted field combinations
  const id = coll.insert({
    'user.name': 'Alice',
    'user.email': 'alice@example.com',
    'settings.theme': 'dark',
    'settings.notifications.email': true,
    'settings.notifications.push': false,
    'data.metrics.2023.january': 100,
    'data.metrics.2023.february': 150
  });
  
  // Test querying with dotted field names
  const found = coll.findOne({'user.name': 'Alice'});
  test.isTrue(found);
  test.equal(found._id, id);
  
  // Test projection with mix of $getField and regular fields
  const projected = coll.findOne(id, {
    fields: {
      userName: { $getField: 'user.name' },
      userEmail: { $getField: 'user.email' },
      theme: { $getField: 'settings.theme' },
      'settings.notifications.email': 1
    }
  });
  
  test.equal(projected.userName, 'Alice');
  test.equal(projected.userEmail, 'alice@example.com');
  test.equal(projected.theme, 'dark');
  test.equal(projected['settings.notifications.email'], true);
  test.isUndefined(projected['user.name']);
  test.isUndefined(projected['settings.theme']);
  
  // Test $setField with complex field names
  coll.update(id, {
    $setField: {
      field: 'config.advanced.feature.enabled',
      value: true
    }
  });
  
  const afterSetField = coll.findOne(id);
  test.equal(afterSetField['config.advanced.feature.enabled'], true);
  
  // Test removing documents with dotted field queries
  const removeCount = coll.remove({'settings.theme': 'dark'});
  test.equal(removeCount, 1);
  test.isUndefined(coll.findOne(id));
});
