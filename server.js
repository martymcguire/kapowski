// server.js
// where your node app starts

// init project
const express = require('express')
const app = express()

// we've started you off with Express, 
// but feel free to use whatever libs or frameworks you'd like through `package.json`.

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'))

// for parsing application/x-www-form-urlencoded POST data
const bodyParser = require('body-parser')
app.use(bodyParser.urlencoded({ extended: true }))

// store session data in user's cookies (so: don't store much of it)
const cookieSession = require('cookie-session')
app.use(cookieSession({
  secret: process.env.SECRET, /* for tamper-proofing */
  maxAge: 24 * 60 * 60 * 1000 /* 1 day */
}))

// this lib provides express routes to handle the IndieAuth dance
const MicropubAuth = require('./lib/micropub-auth')
const micropubAuth = MicropubAuth({
  successRedirect: '/search',
  clientId: 'https://' + process.env.MAIN_URL });
app.use(micropubAuth)

// render html with http://handlebarsjs.com/
var exphbs = require('express-handlebars');
var hbs = exphbs.create({
  defaultLayout: 'main',
  extname: '.hbs',
});
app.engine('hbs', hbs.engine);
app.set('views', __dirname + '/views');
app.set('view engine', 'hbs');

// for posting our form data on to micropub endpoints
// FIXME: use micropub-helper for that instead
const FormData = require('form-data')

// let smarter people build our URLs
const querystring = require('querystring')

// let smarter people handle micropub posting
const Micropub = require('micropub-helper')

// middleware to always set up a context to pass to templates
app.use(function(req, res, next){
  res.locals.context = {};
  if(req.session.user) {
    res.locals.context['user'] = req.session.user
  }
  next();
});

// http://expressjs.com/en/starter/basic-routing.html
app.get("/", (request, response) => {
  response.render('index', response.locals.context)
})

// a middleware to kick people to the homepage if they are not logged in
function requireLogin(request, response, next) {
  if(! request.session.user) { return response.redirect('/') }
  next();
}

app.get('/search', (request, response) => {
  var context = response.locals.context
  var query = request.query.q /* FIXME: sanitize */
  var inReplyTo = request.query['in-reply-to']
  if( inReplyTo ) {
    context['inReplyTo'] = inReplyTo
    context['inReplyToQuery'] = encodeURIComponent(inReplyTo)
  }
  if(query) {
    var qs = querystring.stringify({
      api_key: process.env.GIPHY_API_KEY,
      limit: 25,
      offset: 0,
      rating: 'G',
      lang: 'en',
      q: query
    })
    fetch ('https://api.giphy.com/v1/gifs/search?' + qs)
      .then(res => res.json())
      .then(json => {
        var results = json.data
        // console.log(results)
        context['q'] = request.query.q
        context['results'] = results
        return response.render('search', context )
      })
      .catch((err) => console.log(err))
  } else {
    return response.render('search', context )
  }
})

app.get('/preview/:id', (request, response) => {
  /* FIXME: sanitize id */
  var context = response.locals.context
  var inReplyTo = request.query['in-reply-to']
  if (inReplyTo) {
    context['inReplyTo'] = inReplyTo
  }
  var qs = querystring.stringify( { api_key: process.env.GIPHY_API_KEY } )
  fetch(`https://api.giphy.com/v1/gifs/${request.params.id}?` + qs)
    .then(res => res.json())
    .then(json => {
      var results = json.data
      // console.log(results)
      context['gif'] = results
      return response.render('preview', context)
    })
    .catch((err) => console.log(err))
    /* FIXME: handle 404 or other GIPHY API error */
})

/* Login needed here */
app.post('/post', requireLogin, (request, response) => {
  var props = { photo: [ request.body.originalUrl ] }
  if (request.body.inReplyTo) {
    props['in-reply-to'] = [ request.body.inReplyTo ]
  }
  const micropub = new Micropub({
    token: request.session.user.token,
    micropubEndpoint: request.session.user.micropubEndpoint
  })
  micropub.create({
    type: ['h-entry'],
    properties: props
  })
  .then((url) => response.redirect(url))
  .catch((err) => console.log(err))
})

// listen for requests :)
const listener = app.listen(process.env.PORT, () => {
  console.log(`Your app is listening on port ${listener.address().port}`)
})
