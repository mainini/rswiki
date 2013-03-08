/**
 * @file restify-based node.js-server for the wiki
 * @copyright 2013 Berne University of Applied Sciences (BUAS) -- {@link http://bfh.ch}
 * @author Pascal Mainini <pascal.mainini@bfh.ch>
 * @version 0.1.0
 *
 * ! WARNING ! WARNING ! WARNING ! WARNING ! WARNING ! WARNING !
 *
 * THIS FILE HAS NO DEFINITIVE LICENSING INFORMATION.
 * LICENSE IS SUBJECT OF CHANGE ANYTIME SOON - DO NOT DISTRIBUTE!
 *
 * ! WARNING ! WARNING ! WARNING ! WARNING ! WARNING ! WARNING !
 *
 * This is a node.js-server for the wiki based on restify.
 * It mainly implements a REST-API for CRUD-operations on a wiki-page by using the appropriate REST-verbs.
 *
 * The REST-verbs are implemented in the functions api_getPage(), api_savePage(), api_deletePage(),
 * each of these methods works with a page-"object" taking the following form:
 *
 * page {
 *  name:             {String} name of the page <-> filename without .md
 *  content:          {String} markdown-content of the page-file
 *  changeMessage:    {String} message describing the change/delete of the page
 * }
 *
 * There is no assumption made about any of the values in the page-object beeing present and the functions
 * handling these try to take care of that or at least fail gracefully.
 *
 * Internal "communication" is done entirely by passing these objects between callbacks or returning Errors
 * in case they happen.
 *
 * The REST-API currently supports three content-types: text/plain, text/html and application/json.
 * If application/json is requested, the JSON from the api_*-functions is returned "as-is".
 * Otherwise, content-formatting is done by one of the fmt_*-functions according to the requested content-type.
 */

/*jshint node:true, bitwise:true, curly:true, immed:true, indent:2, latedef:true, newcap:true, noarg: true, noempty:true, nonew:true, quotmark:single, undef:true, unused: true, trailing:true, white:false */
/*global DOCUMENT:true, HTML:true, HEAD:true, BODY:true, META:true, TITLE:true, LINK:true, SCRIPT:true, A:true, DIV:true SPAN:true */

// TODO propper NFE syntax?

/***********************************************************
 * Initialisation
 **********************************************************/

'use strict';

// TODO: make options configurable
var AUDITLOG = true;
var LISTENPORT = 8080;
var WIKIDATA = '/tmp/wikidata';
var PAGEPREFIX = '/page';

var CLIENTRESOURCES = {domo: '/node_modules/domo/lib/domo.js',
                        md_converter: '/node_modules/pagedown/Markdown.Converter.js',
                        md_sanitizer: '/node_modules/pagedown/Markdown.Sanitizer.js',
                        md_editor: '/lib/wmd-editor/Markdown.Editor.js',
                        md_styles: '/lib/wmd-editor/wmd-styles.css',
                        jquery: '/lib/jquery-1.9.0.js',
                        jquery_rest: '/lib/jquery.rest.js',
                        wikifunctions: '/static/wikifunctions.js'};

require('domo').global();

var filesystem = require('fs'),
  pagedown = require('pagedown'),
  restify = require('restify'),
  git = require('gitty'),
  mimeparse = require('mimeparse'),
  bunyan = require('bunyan');

var logger = bunyan.createLogger({    // ISSUE stuff logged with logger.debug somehow doesn't appear at all...
  name: 'wiki',
  stream: process.stdout,
  src: true
});


/***********************************************************
 * Function definitions
 **********************************************************/

//////////////////// REST-API

/**
 * Loads the contents of a wikipage (in markdown) from storage.
 *
 * @param   {restify.Request}   req   Request-object given by restify
 * @param   {restify.Response}  res   Response-object given by restify
 * @param   {Function}          next  Next callback in the chain to call
 * @returns {Object}            The return-value of the next callback in the chain or an Error if something failed.
 */
var api_getPage = function (req, res, next) {
  var pageName = req.params.name;
  var fileName = WIKIDATA + '/' + pageName + '.md';

  logger.info({fileName: fileName, page: {name: pageName}}, 'api_getPage: %s', pageName);

  filesystem.exists(fileName, function _fsExists (exists) {
    if (exists) {
      filesystem.readFile(fileName, 'utf8', function _readErr (err, file) {
        if (err) {
          logger.error({error: err, fileName: fileName, page: {name: pageName}}, 'Error occured while loading page %s : %s', pageName, err);
          return next(err);
        } else {
          return next({page: {content: file, name: req.params.name}});
        }
      });
    } else {
      logger.info({fileName: fileName, page: {name: pageName}}, 'Page %s does not exist, returning "null"-content.', pageName);
      return next({page: {content: null, name: pageName}});
    }
  });
};

/**
 * Saves the contents (markdown) of a wikipage to the storage and performs a git-commit.
 *
 * @param   {restify.Request}   req   Request-object given by restify
 * @param   {restify.Response}  res   Response-object given by restify
 * @param   {Function}          next  Next callback in the chain to call
 * @returns {Object}            Forwards to api_getPage WITHOUT returning it (api_getPage calls next callback) or an Error if something fails.
 */
var api_savePage = function (req, res, next) {
  var pageName = req.params.name;
  var page = req.params.page;
  var fileName = WIKIDATA + '/' + pageName + '.md';

  logger.info({fileName: fileName, page: {name: pageName}}, 'api_savePage: %s', pageName);

  // TODO synchronize the whole thing somehow?
  filesystem.writeFile(fileName, page.content, 'utf8', function _writeErr(err) {
    if (err) {
      logger.error({error: err, fileName: fileName, page: {name: pageName}}, 'Error occured while writing page %s : %s', pageName, err);
      return next(err);
    } else {
      var repo = new git.Repository(WIKIDATA);
      var gitFiles = [pageName + '.md'];

//      git.config('user.name', data.user.name, function _gitConfigNameErr (err) {   // BUG overrides global config
//        if (gitSuccess(err, callback)) {
//          git.config('user.email', data.user.email, function _gitConfigEMail(err) {
//            if (gitSuccess(err, callback)) {
              repo.add(gitFiles, function _gitAddErr (err) {
                if (err) {
                  logger.error({error: err, fileName: fileName, page: {name: pageName}}, 'Error occured while adding to git, trying to unstage: %s', err);
                  repo.unstage(gitFiles, function _gitUnstageErr (err) {
                      if(err) {
                        logger.error({error: err, fileName: fileName, page: {name: pageName}}, 'Error occured while unstaging: %s', err);
                        return next(err);
                      }
                    });
                  return next(err);
                } else {
                  repo.commit(page.changeMessage, function _gitCommitErr (err) {
                    if (err) {
                      logger.error({error: err, fileName: fileName, page: {name: pageName}}, 'Error occured while commiting to git, trying to unstage: %s', err);
                      repo.unstage(gitFiles, function _gitUnstageErr (err) {
                          if (err) {
                            logger.error({error: err, fileName: fileName, page: {name: pageName}}, 'Error occured while unstaging: %s', err);
                            return next(err);
                          }
                        });
                      return next(err);
                    } else {
                      logger.info({fileName: fileName, page: {name: pageName}}, 'Successfully committed page %s.', pageName);
                    }
                  });
                }
              });
//            }
//          });
//        }
//      });
    }
  });

  api_getPage(req, res, next);    // reload page from storage and give it back to caller
};

/**
 * Deletes a page from the storage and from git.
 *
 * @param   {restify.Request}   req   Request-object given by restify
 * @param   {restify.Response}  res   Response-object given by restify
 * @param   {Function}          next  Next callback in the chain to call
 * @returns {Object}            The return-value of the next callback in the chain or an Error if something failed.
 */
var api_deletePage = function (req, res, next) {
  var pageName = req.params.name;
  var page = req.params.page;
  var fileName = WIKIDATA + '/' + pageName + '.md';

  var repo = new git.Repository(WIKIDATA);
  var gitFiles = [pageName + '.md'];

  logger.info({fileName: fileName, page: {name: pageName}}, 'api_deletePage: %s', pageName);

//  git.config('user.name', data.user.name, function _gitConfigNameErr (err) {   // BUG overrides global config
//    if (gitSuccess(err, callback)) {
//      git.config('user.email', data.user.email, function _gitConfigEMailErr (err) {
//        if (gitSuccess(err, callback)) {
          repo.remove(gitFiles, function _gitRemoveErr (err) {
            if (err) {
              logger.error({error: err, fileName: fileName, page: {name: pageName}}, 'Error while removing page %s from git: %s', pageName, err);
              return next(err);
            } else {
              repo.commit(page.changeMessage, function _gitCommitErr (err) {
                if (err) {
                  logger.error({error: err, fileName: fileName, page: {name: pageName}}, 'Error while committing to git: %s', err);
                  return next(err);
                } else {
                  filesystem.unlink(fileName, function _unlinkErr (err) {
                    if (err) {
                      logger.error({error: err, fileName: fileName, page: {name: pageName}}, 'Error while deleting page %s : %s', pageName, err);
                      return next(err);
                    } else {
                      logger.info({fileName: fileName, page: {name: pageName}}, 'Successfully deleted page %s.', pageName);
                      return next({page: {content: null, name: pageName}});
                    }
                  });
                }
              });
            }
          });
//        }
//      });
//    }
//  });
};


//////////////////// output-formatters

/**
 * Formatter called by restify when requestor wants text/html.
 *
 * @param   {restify.Request}   req   Request-object given by restify
 * @param   {restify.Response}  res   Response-object given by restify
 * @param   {Object}            body  The effective wiki-page as returned by the api_*-methods as JSON.
 * @returns {String}            HTML-representation of the page (or the Error)
 */
var fmt_Html = function (req, res, body) {

  if (body instanceof Error) {

    return DOCUMENT(
      HTML({lang: 'en'},
        HEAD(
          META({charset: 'utf-8'}),
          TITLE(body.statusCode ? body.statusCode  + ': ' + body.message : body.message)
        ),
        BODY(
          DIV({id: 'wiki_error'}, (body.statusCode ? body.statusCode  + ': ' + body.message : body.message))
        )
      )
    ).outerHTML + '\n';

  } else {

    var pageContent;
    if (body.page.content) {
      pageContent = pagedown.getSanitizingConverter().makeHtml(body.page.content);   // or: new pagedown.Converter();
    } else {
      pageContent = '';
    }

    return DOCUMENT(
      HTML({lang: 'en'},
        HEAD(
          META({charset: 'utf-8'}),
          TITLE(body.page.name),
          LINK({rel: 'stylesheet', type: 'text/css', href: CLIENTRESOURCES.md_styles}),
          SCRIPT({src: CLIENTRESOURCES.domo}),
          SCRIPT({src: CLIENTRESOURCES.md_converter}),
          SCRIPT({src: CLIENTRESOURCES.md_sanitizer}),
          SCRIPT({src: CLIENTRESOURCES.md_editor}),
          SCRIPT({src: CLIENTRESOURCES.jquery}),
          SCRIPT({src: CLIENTRESOURCES.jquery_rest}),
          SCRIPT({src: CLIENTRESOURCES.wikifunctions})
        ),
        BODY(
          DIV({id: 'wiki_header'},
            DIV({id: 'wiki_title'}, body.page.name),
            DIV({id: 'wiki_navi'},
              A({id: 'wiki_button_edit', href: '#'}, 'edit'),
              SPAN({id: 'wiki_button_delete'}, ' | ', A({href: '#'}, 'delete'))
            )
          ),
          DIV({id: 'wiki_editor'}),
          DIV({id: 'wiki_content'}, '%#%PAGECONTENT%#%')
        )
      )
    ).outerHTML.replace('%#%PAGECONTENT%#%', pageContent) + '\n';   // or: new pagedown.Converter();

  }
};

/**
 * Formatter called by restify when requestor wants text/plain.
 *
 * @param   {restify.Request}   req   Request-object given by restify
 * @param   {restify.Response}  res   Response-object given by restify
 * @param   {Object}            body  The effective wiki-page as returned by the api_*-methods as JSON.
 * @returns {String}            Plaintext-representation of the page (or the Error)
 */
var fmt_Text = function (req, res, body) {
  if (body instanceof Error) {
    return 'Error!\n\n' +
      (body.statusCode ? 'Statuscode: ' + body.statusCode + '\n' : '') +
      'Message: ' + body.message + '\n';
  } else {
    return 'Title: ' + body.page.name +
      '\n------------------ START CONTENT --------------------\n' +
      body.page.content +
      '\n------------------- END CONTENT ---------------------\n';
  }
};


/***********************************************************
 * Main application
 **********************************************************/

//////////////////// setup server

var server = restify.createServer({
  formatters: {
    'text/html': fmt_Html,
    'text/plain': fmt_Text
    // application/json gets implicitly handled by restify
  }
});  // TODO SSL...

//// server: events
if (AUDITLOG) {
  server.on('after', restify.auditLogger({log: logger}));
}

// ISSUE workaround for seemingly improper accept-header-evaluation by restify...
server.pre(function _mimeFix (req, res, next) {
  req.headers.accept = mimeparse.bestMatch(['text/plain','text/html','application/json'], req.headers.accept);
  return next();
});

//// server: general handlers
server.use(restify.requestLogger());    // ISSUE requestLogger logs NOTHING!
server.use(restify.bodyParser());
server.use(restify.acceptParser(server.acceptable));

//// server: static content
server.get(/\/static\/?.*/, restify.serveStatic({directory: '.'}));   // ISSUE serveStatic doesn't emit NotFound-event...
server.get(/\/lib\/?.*/, restify.serveStatic({directory: '.'}));
server.get(/\/node_modules\/?.*/, restify.serveStatic({directory: '.'}));

//// server: page API
server.get(PAGEPREFIX + '/:name', api_getPage);   // TODO GET redirect / to a mainpage or provide a list of pages?
server.put(PAGEPREFIX + '/:name', api_savePage);
server.post(PAGEPREFIX + '/:name', api_savePage);
server.del(PAGEPREFIX + '/:name', api_deletePage);

//// start server
server.listen(LISTENPORT, function listenCallback () {
  logger.info({serverName: server.name, serverURL: server.url}, '%s listening at %s.', server.name, server.url);
});
