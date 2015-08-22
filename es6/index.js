const fetch = global.fetch || require('node-fetch');
import convert from 'xml-json';
import concat from 'concat-stream';
import { Agent } from 'https';


export default ({server, token, refreshToken}) => {
  const agent = new Agent({
    keepAlive: true
  });

  const _fetch = (
    url,
    {method='GET', headers={}, body=undefined}
    = {method: 'GET', headers: {}}

  ) => {
    const _headers = Object.assign({
      Accept: '*/*',
      'Connection': 'keep-alive',
      'Content-Type': 'application/xml;charset=utf-8',
      Authorization: `Bearer ${token}`
    }, headers);

    return fetch(url, {method, headers: _headers, body, agent});
  };

  async function _responseAsJSON(res, prop) {
    const xml = await res.text();
    let _prop = prop;

    if (res.status === 401 && xml.match(/<code>authError<\/code>/) ) {
      _prop = 'error';
    }

    const json = await new Promise(resolve => {
      const converter = convert(_prop);
      converter.pipe( concat(resolve) );
      converter.write(xml);
      converter.end();
    });

    if (res.status === 401 && xml.match(/<code>authError<\/code>/) ) {
      const err = new Error(json[0].internalReason);
      err.code = json[0].code;
      throw err;
    }


    return json;
  }



  function fetchPropFind(url, props, depth = 0) {
    const body = `<?xml version="1.0"?>
        <d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
          <d:prop>
             ${props.concat('\n')}

          </d:prop>
        </d:propfind>`;

    const headers = depth ? {DEPTH: depth} : {};

    return _fetch(url, {
      method: 'PROPFIND',
      headers,
      body
    });
  }


  return {
    async listAddressBooks({addressbookHomeSet}) {
      const res = await fetchPropFind(
        `${server}${addressbookHomeSet}`,
        ['<d:resourcetype />', '<d:displayname />'],
        1
      );

      const responses = await _responseAsJSON(res, 'd:response');

      const result = responses.map(resp => ({
        url: resp['d:href'],
        displayName: resp['d:propstat']['d:prop']['d:displayname'],
        resourceType: Object.keys(resp['d:propstat']['d:prop']['d:resourcetype'])[0].slice(2)
      }));
      return result;
    },

    async listContacts({addressBookUrl}) {
      const res = await _fetch(`${server}${addressBookUrl}`, {
        method: 'REPORT',
        body: `
          <card:addressbook-query xmlns:card="urn:ietf:params:xml:ns:carddav"
             xmlns:d="DAV:">
            <d:prop>
                <d:getetag />
                <card:address-data />
            </d:prop>
            <card:filter>
              <card:prop-filter name="FN">
              </card:prop-filter>
            </card:filter>
          </card:addressbook-query>`
      });
      const responses = await _responseAsJSON(res, 'd:response');
      const result = responses.map(resp => ({
        url: resp['d:href'],
        etag: resp['d:propstat']['d:prop']['d:getetag'],
        vcard: resp['d:propstat']['d:prop']['card:address-data']
      }));
      return result;
    },

    async insertContact({addressBookUrl, vcard}) {
      const res = await _fetch(`${server}${addressBookUrl}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/vcard;charset=utf-8'
        },
        body: vcard
      });

      if (res.status !== 201) {
        throw new Error('Cannot insert contact: http status ' + res.status);
      }

      return {
        UID: res.headers.get('Location').split('/').slice(-1)[0],
        etag: res.headers.get('ETag')
      };
    },


    async getContact({addressBookUrl, UID}) {
      const res = await _fetch(`${server}${addressBookUrl}${UID}`);
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200) {
        throw new Error('Cannot get contact: http status ' + res.status);
      }
      return await res.text();
    },

    async deleteContact({addressBookUrl, UID}) {
      const res = await _fetch(`${server}${addressBookUrl}${UID}`, {
        method: 'DELETE'
      });
      if (res.status !== 204) {
        throw new Error('Cannot delete contact: http status ' + res.status);
      }
      return await res.text();
    },


    async updateContact({addressBookUrl, UID, vcard}) {
      const res = await _fetch(`${server}${addressBookUrl}${UID}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/vcard;charset=utf-8'
        },
        body: vcard
      });

      if (res.status !== 204) {
        throw new Error('Cannot delete contact: http status ' + res.status);
      }
      return await res.text();
    },


    async discoverAccount() {
      const res = await fetchPropFind(
        `${server}/.well-known/carddav`,
        ['<d:current-user-principal />', '<d:principal-URL />']
      );

      const href = await _responseAsJSON(res, 'd:prop');
      const result = {
        principalURL: href[0]['d:principal-URL']['d:href'],
        currentUserPrincipal: href[0]['d:current-user-principal']['d:href']
      };

      const res2 = await fetchPropFind(
        `${server}${result.principalURL}`,
        ['<card:addressbook-home-set />']
      );

      const href2 = await _responseAsJSON(res2, 'd:prop');
      result.addressbookHomeSet = href2[0]['card:addressbook-home-set']['d:href'];

      return result;
    }
  };
};
