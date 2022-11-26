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

// sometimes we have to make our own HTTP reqs
const axios = require('axios')

// middleware to always set up a context to pass to templates
app.use(function(req, res, next){
  res.locals.context = {};
  if(req.session.user) {
    res.locals.context['user'] = req.session.user
  }
  next();
});

// a middleware to kick people to the homepage if they are not logged in
function requireLogin(request, response, next) {
  if(! request.session.user) { return response.redirect('/') }
  next();
}

// sometimes we need to read and write files
const fs = require('fs');

// a middleware to load, check, update our GFYCAT OAuth token
function requireGfycatToken(request, response, next) {
  // goal: set request.session.gfycat_token
  // - load .data/.gfycat (JSON obj w/ 'token','expires')
  // - if not present or expires < now, do request
  let token_cache = null;
  if(fs.existsSync('.data/.gfycat')) {
    token_cache = JSON.parse(fs.readFileSync('.data/.gfycat'));
    const now_secs = Math.floor(Date.now() / 1000);
    if (now_secs > token_cache.expires) {
      // expired 😢 (it's okay, we'll requests a new one)
      token_cache = null;
    } else {
      // cached token still good! use it!
      request.session.gfycat_token = token_cache.access_token;
      next();
    }
  }
  if (token_cache == null) {
    console.log('Requesting new Gfycat API token')
    axios.post('https://api.gfycat.com/v1/oauth/token', 
      JSON.stringify({
        grant_type: 'client_credentials',
        client_id: process.env.GFYCAT_CLIENT_ID,
        client_secret: process.env.GFYCAT_CLIENT_SECRET
      }),
      { headers: { 'Content-Type': 'application/json' },
    })
    .then(res => { 
      if(res.status === 200) {
        return res.data;
      } else {
        // something went wrong. render a sad gfycat.
      }
    })
    .then(json => {
      const token_cache = {
        access_token: json.access_token,
        expires: (Math.floor(Date.now() / 1000) + json.expires_in)
      };

      console.log(token_cache);

      fs.writeFile('.data/.gfycat', JSON.stringify(token_cache), (err) => { if(err) {console.log(err);}} );

      request.session.gfycat_token = token_cache.access_token;
      next();
    });  
  } // end if token_cache == null
}

// http://expressjs.com/en/starter/basic-routing.html
app.get("/", (request, response) => {
  response.render('index', response.locals.context)
})

app.get('/search', requireGfycatToken, (request, response) => {
  var context = response.locals.context
  var query = request.query.q /* FIXME: sanitize */
  var inReplyTo = request.query['in-reply-to']
  if( inReplyTo ) {
    context['inReplyTo'] = inReplyTo
    context['inReplyToQuery'] = encodeURIComponent(inReplyTo)
  }
  if(query) {
    var qs = querystring.stringify({
      count: 25,
      search_text: query
    })
    axios.get ('https://api.gfycat.com/v1/gfycats/search?' + qs, {
      headers: {
        'Authorization': 'Bearer ' + request.session.gfycat_token
      }
    })
      .then(res => {
        const json = res.data;
        //console.log(json);
        //return response.send(JSON.stringify(json)); // DEBUGGING LOL
        var results = json.gfycats
        context['q'] = request.query.q
        context['results'] = results
        return response.render('search', context )
      })
      .catch((err) => console.log(err))
  } else {
    return response.render('search', context )
  }
})

app.get('/preview/:id', requireGfycatToken, (request, response) => {
  /* FIXME: sanitize id */
  var context = response.locals.context
  var inReplyTo = request.query['in-reply-to']
  if (inReplyTo) {
    context['inReplyTo'] = inReplyTo
  }
  axios.get(`https://api.gfycat.com/v1/gfycats/${request.params.id}`)
    .then(res => {
      const json = res.data;
      //return response.send(JSON.stringify(json)); // DEBUGGING LOL
      var results = json.gfyItem;
      context['gif'] = results
      return response.render('preview', context)
    })
    .catch((err) => console.log(err))
    /* FIXME: handle 404 or other API error */
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
