const https = require('https')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const hljs = require('highlight.js/lib/core')
hljs.registerLanguage('javascript', require('highlight.js/lib/languages/javascript'))
hljs.registerLanguage('xml', require('highlight.js/lib/languages/xml'))
hljs.registerLanguage('css', require('highlight.js/lib/languages/css'))

function removeHtmlTag(content) {
  content = content.replace(/(?:<\/?[a-z][a-z1-6]{0,9}>|<[a-z][a-z1-6]{0,9} .+?>)/gi, '')
  return content.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
}

function getLanguageRefrence(language) {
  return new Promise((resolve, reject) => {
    https.get('https://developer.mozilla.org/en-US/docs/Web/' + language.toUpperCase() + '/Index' + '?raw&macros', (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error('😱  返回状态码 --- ', res.statusCode))
      }
      res.setEncoding('utf8')
      let rawData = ''
      res.on('data', (chunk) => { rawData += chunk })
      res.on('end', () => {
        const matches = rawData.match(/<td rowspan="2">\d{1,4}<\/td>\s*<td rowspan="2"><a href="[^"\n]+?">[^<\n]+?<\/a><\/td>\s*<td><strong>[^<\n]*?<\/strong><\/td>\s*<\/tr>\s*<tr>\s*<td>.+?<\/td>\s*<\/tr>/gs)
        if (!matches) {
          return reject(new Error('😱  列表获取失败，未正确解析'))
        }
        let refrences = []
        try {
          matches.forEach((x, i) => {
            const matchs = x.match(/<td rowspan="2">(\d{1,4})<\/td>\s*<td rowspan="2"><a href="([^"\n]+?)">([^<\n]+?)<\/a><\/td>\s*<td><strong>[^<\n]*?<\/strong><\/td>\s*<\/tr>\s*<tr>\s*<td>(.+?)<\/td>\s*<\/tr>/s)
            const index = parseInt(matchs[1])
            if (index !== i + 1) {
              console.log(x)
              console.log(matches[i - 1])
              throw new Error('第' + (i + 1) + '条索引获取失败')
            }
            const src = matchs[2].trim()
            const key = removeHtmlTag(matchs[3].trim())
            const summary = matchs[4].trim()
            refrences.push({ key, src, summary })
          })
        } catch (e) {
          return reject(new Error('😱  ' + e.message))
        }
        if (!fs.existsSync(path.join(__dirname, 'data'))) {
          fs.mkdirSync(path.join(__dirname, 'data'))
        }
        fs.writeFileSync(path.join(__dirname, 'data', language + '-refrences.json'), JSON.stringify(refrences, null, 2))
        resolve()
      })
    }).on('error', (e) => { reject(e) })
  })
}

// 获取描述摘要
function getDocSummary(item) {
  return new Promise((resolve, reject) => {
    // https.get('https://developer.mozilla.org' + src + '?raw&summary', (res) => {
    //   if (res.statusCode !== 200) {
    //     return reject(new Error('😱  获取摘要 返回状态码 --- ' + res.statusCode + '\n' + src))
    //   }
    //   res.setEncoding('utf8')
    //   let rawData = ''
    //   res.on('data', (chunk) => { rawData += chunk })
    //   res.on('end', () => {
    //     rawData = removeHtmlTag(rawData).replace(/\s+/g, ' ').trim()
    //     resolve(rawData)
    //   })
    // })
    resolve(removeHtmlTag(item.summary).replace(/\s+/g, ' ').trim())
  })
}

function convertHtmlContent(lowerSrcArray, htmlContent, src) {
  const matches = htmlContent.match(/(?:(<ul\s+id="toc-entries"\s*>.*?<\/ul>).*?)?(<article[^\n]*?class="main-page-content"[^\n]*?>[\s\S]+?<\/article>)/s)
  const toc = matches[1]
  htmlContent = matches[2]
  htmlContent = htmlContent.replace(/<section class="Quick_links" id="Quick_Links">[\s\S]+?<\/section>/, '')
  if (htmlContent.includes('class="prevnext"')) {
    htmlContent = htmlContent.replace(/<div class="prevnext"[\s\S]+?<\/div>/g, '')
  }
  if (htmlContent.includes('<iframe ')) {
    htmlContent = htmlContent.replace(/<iframe.+src="([^"\n]+?)"[^>\n]*?>.*?<\/iframe>/g, '<a class="interactive-examples-link" href="$1">查看示例</a>')
  }
  const links = htmlContent.match(/<a[^>\n]+?href="[^"\n]+?"/g)
  if (links) {
    // 链接集合
    const linkSet = new Set(links)
    for (let link of linkSet) {
      let url = link.match(/<a[^>\n]+?href="([^"\n]+?)"/)[1].trim()
      if (url.startsWith('https://developer.mozilla.org')) {
        let shortUrl = url.replace('https://developer.mozilla.org', '')
        let anchor = ''
        if (shortUrl.includes('#')) {
          anchor = shortUrl.substring(shortUrl.indexOf('#'))
          shortUrl = shortUrl.substring(0, shortUrl.indexOf('#'))
        }
        if (lowerSrcArray.includes(shortUrl.toLowerCase())) {
          const localFile = crypto.createHash('md5').update(shortUrl.toLowerCase()).digest('hex')
          let replaceText = 'href="' + url + '"'
          htmlContent = htmlContent.replace(new RegExp(replaceText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'href="' + localFile + '.html' + anchor + '"')
        }
        continue
      }
      if (/^https?:\/\//i.test(url)) continue
      const replaceRegex = new RegExp(('href="' + url + '"').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      let anchor = ''
      if (url.includes('#')) {
        anchor = url.substring(url.indexOf('#'))
        url = url.substring(0, url.indexOf('#'))
      }
      if (lowerSrcArray.includes(url.toLowerCase())) {
        const localFile = crypto.createHash('md5').update(url.toLowerCase()).digest('hex')
        htmlContent = htmlContent.replace(replaceRegex, 'href="' + localFile + '.html' + anchor + '"')
      } else if (url.startsWith('/')) {
        htmlContent = htmlContent.replace(replaceRegex, 'href="https://developer.mozilla.org' + url + anchor + '"')
      } else {
        htmlContent = htmlContent.replace(replaceRegex, 'href="javascript:void(0)"')
      }
    }
  }
  htmlContent = htmlContent.replace(/(<img[^>\n]+?src=")(\/[^"\n]+?")/g, '$1https://developer.mozilla.org$2')
  // JS 代码美化
  const jsCodes = htmlContent.match(/<pre.*?class="brush: ?js[^"\n]*?">[\s\S]+?<\/pre>/g)
  if (jsCodes) {
    jsCodes.forEach(preRaw => {
      const highlightedCode = hljs.highlight(removeHtmlTag(preRaw), { language: 'javascript' }).value
      htmlContent = htmlContent.replace(preRaw, '<pre><code class="javascript hljs">' + highlightedCode + '</code></pre>')
    })
  }
  // HTML 代码美化
  const htmlCodes = htmlContent.match(/<pre.*?class="brush: ?html[^"\n]*?">[\s\S]+?<\/pre>/g)
  if (htmlCodes) {
    htmlCodes.forEach(preRaw => {
      const highlightedCode = hljs.highlight(removeHtmlTag(preRaw), { language: 'xml' }).value
      const classNames = preRaw.match(/<pre.*?class="brush: ?html([^"\n]*?)">/)
      htmlContent = htmlContent.replace(preRaw, `<pre class="${classNames[1]}"><code class="xml hljs">` + highlightedCode + '</code></pre>')
    })
  }
  // CSS 代码美化
  const cssCodes = htmlContent.match(/<pre.*?class="brush: ?css[^"\n]*?">[\s\S]+?<\/pre>/g)
  if (cssCodes) {
    cssCodes.forEach(preRaw => {
      const highlightedCode = hljs.highlight(removeHtmlTag(preRaw), { language: 'css' }).value
      htmlContent = htmlContent.replace(preRaw, '<pre><code class="css hljs">' + highlightedCode + '</code></pre>')
    })
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title></title><link rel="stylesheet" href="doc.css" /></head>
  <body><a class="view-origin" href="https://developer.mozilla.org/${src}">去MDN上查看</a>
  <details open class="toc-container"><summary>Table of Contents</summary>${toc}</details>${htmlContent}</body></html>`
  // const jsSyntaxCodes = rawData.match(/<pre.*?class="syntaxbox">[\s\S]+?<\/pre>/g)
  // if (jsSyntaxCodes) {
  //   jsSyntaxCodes.forEach(preRaw => {
  //     const highlightedCode = hljs.highlight('javascript', removeHtmlTag(preRaw)).value
  //     rawData = rawData.replace(preRaw, '<pre><code class="javascript hljs">' + highlightedCode + '</code></pre>')
  //   })
  // }
}

// 获取页面
function getDocPage(lowerSrcArray, src, language) {
  const filename = crypto.createHash('md5').update(src.toLowerCase()).digest('hex')
  const cachePath = path.join(__dirname, 'data', language, filename)
  // 如果存在缓存, 则使用缓存中的文件
  if (fs.existsSync(cachePath)) {
    return new Promise((resolve, reject) => {
      fs.readFile(cachePath, { encoding: 'utf-8' }, (err, data) => {
        if (err) {
          return reject(err)
        }
        fs.writeFileSync(path.join(__dirname, 'public', language, 'docs', filename + '.html'), convertHtmlContent(lowerSrcArray, data, src))
        resolve('docs/' + filename + '.html')
      })
    })
  }
  // 没有缓存, 则下载并缓存
  else {
    return new Promise((resolve, reject) => {
      https.get('https://developer.mozilla.org' + src + '?raw&macros', (res) => {
        if (res.statusCode !== 200) {
          if (res.statusCode === 301 || res.statusCode === 302) {
            return reject(new Error('redirect:' + res.headers['location']))
          }
          return reject(new Error('🥵  获取页面 返回状态码 *** ' + res.statusCode + '\n' + src))
        }
        res.setEncoding('utf8')
        let rawData = ''
        res.on('data', (chunk) => { rawData += chunk })
        res.on('end', () => {
          // 保存一份缓存
          const cacheDir = path.join(__dirname, 'data', language)
          if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir)
          }
          const dataDir = path.join(__dirname, 'public', language, 'docs')
          if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir)
          }
          fs.writeFileSync(path.join(cacheDir, filename), rawData)
          fs.writeFileSync(path.join(dataDir, filename + '.html'), convertHtmlContent(lowerSrcArray, rawData, src))
          resolve('docs/' + filename + '.html')
        })
      })
    })
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const language = argv[0]
  if (!fs.existsSync(path.join(__dirname, 'data', language + '-refrences.json'))) {
    try {
      await getLanguageRefrence(language)
    } catch (e) {
      console.log(e.message)
      return
    }
    console.log(language + '----------索引获取完成---------')
  }
  const refrences = require('./data/' + language + '-refrences.json')
  const lowerSrcArray = refrences.map(x => x.src.toLowerCase())
  const failItems = []
  const indexesFilePath = path.join(__dirname, 'public', language, 'indexes.json')
  let indexes = []
  let oldIndexes = null
  if (fs.existsSync(indexesFilePath)) {
    oldIndexes = require('./public/' + language + '/indexes.json')
  }
  for (let i = 0; i < refrences.length; i++) {
    const item = refrences[i]
    let t = item.key
    let p
    let d
    try {
      p = await getDocPage(lowerSrcArray, item.src, language)
      if (oldIndexes) {
        const oldItem = oldIndexes.find(x => x.t === t)
        if (oldItem) {
          d = oldItem.d
        } else {
          d = await getDocSummary(item)
        }
      } else {
        d = await getDocSummary(item)
      }
    } catch (e) {
      if (e.message.startsWith('redirect:')) {
        item.src = e.message.replace('redirect:', '').replace('?raw=&macros=', '')
      }
      failItems.push(item)
      console.log('fail-------', e.message)
      continue
    }
    indexes.push({ t, p, d })
    console.log('ok-------', `${i + 1}/${refrences.length}`, item.src)
  }
  for (let i = 0; i < failItems.length; i++) {
    const item = failItems[i]
    try {
      const d = await getDocSummary(item)
      const p = await getDocPage(lowerSrcArray, item.src, language)
      indexes.push({ t: item.key, p, d })
    } catch (e) {
      console.log('重试获取失败---------', e.message)
    }
  }
  fs.writeFileSync(path.join(__dirname, 'data', language + '-refrences.json'), JSON.stringify(refrences, null, 2))
  fs.writeFileSync(indexesFilePath, JSON.stringify(indexes))
  fs.copyFileSync(path.join(__dirname, 'doc.css'), path.join(__dirname, 'public', language, 'docs', 'doc.css'))
  console.log('--------  😁 😁 😁 😁 😁 😁 😁 😁 😁 😁 --------')
}

main()
