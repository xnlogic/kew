/**
 * An object representing a "promise" for a future value
 *
 * @param {function(Object)} onSuccess a function to handle successful
 *     resolution of this promise
 * @param {function(Error)} onFail a function to handle failed
 *     resolution of this promise
 * @constructor
 */
function Promise(onSuccess, onFail) {
  this.promise = this
  this._isPromise = true
  this._successFn = onSuccess
  this._failFn = onFail
}

/**
 * Resolve this promise with a specified value
 *
 * @param {Object} data
 */
Promise.prototype.resolve = function (data) {
  if (this._error || this._hasData) throw new Error("Unable to resolve or reject the same promise twice")

  var i
  if (data && data._isPromise) {
    this._child = data
    if (this._promises) {
      for (var i = 0; i < this._promises.length; i += 1) {
        data._chainPromise(this._promises[i])
      }
      delete this._promises
    }

    if (this._onComplete) {
      for (var i = 0; i < this._onComplete.length; i+= 1) {
        data.fin(this._onComplete[i])
      }
      delete this._onComplete
    }
    return
  }

  this._hasData = true
  this._data = data

  if (this._onComplete) {
    for (i = 0; i < this._onComplete.length; i++) {
      this._onComplete[i]()
    }
  }

  if (this._promises) {
    for (i = 0; i < this._promises.length; i += 1) {
      this._promises[i]._withInput(data)
    }
    delete this._promises
  }
}

/**
 * Reject this promise with an error
 *
 * @param {Error} e
 */
Promise.prototype.reject = function (e) {
  if (this._error || this._hasData) throw new Error("Unable to resolve or reject the same promise twice")

  var i
  this._error = e

  if (this._ended) {
    process.nextTick(function () {
      throw e
    })
  }

  if (this._onComplete) {
    for (i = 0; i < this._onComplete.length; i++) {
      this._onComplete[i]()
    }
  }

  if (this._promises) {
    for (i = 0; i < this._promises.length; i += 1) {
      this._promises[i]._withError(e)
    }
    delete this._promises
  }
}

/**
 * Provide a callback to be called whenever this promise successfully
 * resolves. Allows for an optional second callback to handle the failure
 * case.
 *
 * @param {function(Object)} onSuccess
 * @param {?function(Error)} onFail
 * @return {Promise} returns a new promise with the output of the onSuccess or
 *     onFail handler
 */
Promise.prototype.then = function (onSuccess, onFail) {
  var promise = new Promise(onSuccess, onFail)

  if (this._child) this._child._chainPromise(promise)
  else this._chainPromise(promise)

  return promise
}

/**
 * Provide a callback to be called whenever this promise is rejected
 *
 * @param {function(Error)} onFail
 * @return {Promise} returns a new promise with the output of the onFail handler
 */
Promise.prototype.fail = function (onFail) {
  return this.then(null, onFail)
}

/**
 * Provide a callback to be called whenever this promise is either resolved
 * or rejected.
 *
 * @param {function()} onComplete
 * @return {Promise} returns the current promise
 */
Promise.prototype.fin = function (onComplete) {
  if (this._hasData || this._error) {
    onComplete()
    return this
  }

  if (this._child) {
    this._child.fin(onComplete)
  } else {
    if (!this._onComplete) this._onComplete = [onComplete]
    else this._onComplete.push(onComplete)
  }

  return this
}

/**
 * Mark this promise as "ended". If the promise is rejected, this will throw an
 * error in whatever scope it happens to be in
 *
 * @return {Promise} returns the current promise
 */
Promise.prototype.end = function () {
  if (this._error) {
    throw this._error
  }
  this._ended = true
  return this
}

/**
 * Attempt to resolve this promise with the specified input
 *
 * @param {Object} data the input
 */
Promise.prototype._withInput = function (data) {
  if (this._successFn) {
    try {
      this.resolve(this._successFn(data))
    } catch (e) {
      this.reject(e)
    }
  } else this.resolve(data)
}

/**
 * Attempt to reject this promise with the specified error
 *
 * @param {Error} e
 */
Promise.prototype._withError = function (e) {
  if (this._failFn) {
    try {
      this.resolve(this._failFn(e))
    } catch (e) {
      this.reject(e)
    }
  } else this.reject(e)
}

/**
 * Chain a promise to the current promise
 *
 * @param {Promise} the promise to chain
 */
Promise.prototype._chainPromise = function (promise) {
  var i

  if (this._child) {
    this._child._chainPromise(promise)
  } else if (this._hasData) {
    promise._withInput(this._data)
  } else if (this._error) {
    promise._withError(this._error)
  } else if (!this._promises) {
    this._promises = [promise]
  } else {
    this._promises.push(promise)
  }
}

/**
 * Utility function used for creating a node-style resolver
 * for deferreds
 *
 * @param {Promise} deferred a promise that looks like a deferred
 * @param {Error} err an optional error
 * @param {Object} data optional data
 */
function resolver(deferred, err, data) {
  if (err) deferred.reject(err)
  else deferred.resolve(data)
}

/**
 * Creates a node-style resolver for a deferred by wrapping
 * resolver()
 *
 * @return {function(Error, Object)} node-style callback
 */
Promise.prototype.makeNodeResolver = function () {
  return resolver.bind(null, this)
}

/**
 * Static function which creates and resolves a promise immediately
 *
 * @param {Object} data data to resolve the promise with
 * @return {Promise}
 */
function resolve(data) {
  var promise = new Promise()
  promise.resolve(data)
  return promise
}

/**
 * Static function which creates and rejects a promise immediately
 *
 * @param {Error} e error to reject the promise with
 * @return {Promise}
 */
function reject(e) {
  var promise = new Promise()
  promise.reject(e)
  return promise
}

/**
 * Replace an element in an array with a new value. Used by .all() to
 * call from .then()
 *
 * @param {Array.<Object>} arr
 * @param {number} idx
 * @param {Object} val
 * @return {Object} the val that's being injected into the array
 */
function replaceEl(arr, idx, val) {
  arr[idx] = val
  return val
}

/**
 * Takes in an array of promises or literals and returns a promise which returns
 * an array of values when all have resolved. If any fail, the promise fails.
 *
 * @param {Array.<Promise|Object>} promises
 * @return {Promise.<Array.<Object>>}
 */
function all(promises) {
  if (!promises.length) return resolve([])

  var outputs = []
  var counter = 0
  var finished = false
  var promise = new Promise()
  var counter = promises.length

  for (var i = 0; i < promises.length; i += 1) {
    if (!promises[i] || !promises[i]._isPromise) {
      outputs[i] = promises[i]
      counter -= 1
    } else {
      promises[i].then(replaceEl.bind(null, outputs, i))
      .then(function () {
        counter--
        if (!finished && counter === 0) {
          finished = true
          promise.resolve(outputs)
        }
      }, function (e) {
        if (!finished) {
          finished = true
          promise.reject(e)
        }
      })
    }
  }

  if (counter === 0 && !finished) {
    finished = true
    promise.resolve(outputs)
  }

  return promise
}

/**
 * Create a new Promise which looks like a deferred
 *
 * @return {Promise}
 */
function defer() {
  return new Promise()
}

module.exports = {
    resolve: resolve
  , reject: reject
  , all: all
  , defer: defer
}