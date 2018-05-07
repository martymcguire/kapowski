/**
 * An Express middleware for micropub clients!
 * Requires a req.session.
 * Stores auth state during the round trip to the auth server (req.session.state and req.session.csrfSecret).
 * After handling a successful return from the auth server,
 * data about the logged in user are in req.session.user:
 * { me: http://example.com,
 *   token: "Xxxxxxxxx...",
 *   authEndpoint: "...",
 *   tokenEndpoint: "...",
 *   micropubEndpoint: "..."
 * }
 */

const express = require('express')
const Micropub = require('micropub-helper')
const crypto = require('crypto')

module.exports = function (options) {
  const opts = Object.assign(
    {
      clientId: 'https://' + process.env.PROJECT_DOMAIN + '.glitch.me',
      authStartPath: '/signin',
      indieAuthHandlerPath: '/indieauthhandler',
      scope: 'create',
      successRedirect: '/dashboard'
    },
    options
  )

  const rtr = express.Router()
  
  // Begin the IndieAuth dance. Looks for request.body.me for the user's URL.
  rtr.post(opts.authStartPath, (request, response) => {
    // console.log(request.body)
    request.session.csrfSecret = crypto.randomBytes(32).toString('base64')
    if(request.body.returnTo) {
      request.session.returnTo = request.body.returnTo;
    } else {
      delete request.session.returnTo;
    }
    delete request.session.user
    const micropub = new Micropub({
      clientId: opts.clientId,
      redirectUri: request.protocol + '://' + request.get('host') + opts.indieAuthHandlerPath,
      me: request.body.me,
      state: request.session.csrfSecret,
      scope: opts.scope
    })
    micropub.getAuthUrl()
    .then((url) => {
      request.session.state = { 
        me: request.body.me,
        authEndpoint: micropub.options.authEndpoint,
        tokenEndpoint: micropub.options.tokenEndpoint,
        micropubEndpoint: micropub.options.micropubEndpoint
      }
      response.redirect(url)
    })
    .catch((err) => {
      console.log(err)
      response.status(400).send(err)
    })
  })
  
  // Handle the return from the authorization endpoint.
  // Convert code to token, store user data in req.session.
  rtr.get(opts.indieAuthHandlerPath, (request, response) => {
    const micropub = new Micropub({
      clientId: opts.clientId,
      redirectUri: request.protocol + '://' + request.get('host') + opts.indieAuthHandlerPath,
      state: request.query.state, /* FIXME: check state against our stored state */
      scope: opts.scope,
      ...request.session.state
    })
    // console.log(micropub.options)
    micropub.getToken(request.query.code)
    .then(token => {
      request.session.user = {
        ...request.session.state,
        token: token
      }
      delete request.session.state
      delete request.session.csrfSecret
      var redir = opts.successRedirect;
      if( request.session.returnTo ){
        redir = request.session.returnTo;
        delete request.session.returnTo;
      }
      response.redirect(redir)
    })
    .catch(err => {
      console.log(err)
      response.send(400, err)
    })
  })
  return rtr
}