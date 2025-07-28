function getXmlHttp(){
  var xmlhttp;
  try {
    xmlhttp = new ActiveXObject("Msxml2.XMLHTTP");
  } catch (e) {
    try {
      xmlhttp = new ActiveXObject("Microsoft.XMLHTTP");
    } catch (E) {
      xmlhttp = false;
    }
  }
  if (!xmlhttp && typeof XMLHttpRequest!='undefined') {
    xmlhttp = new XMLHttpRequest();
  }
  return xmlhttp;
}

function appendDep(dep, target) {
  var child = document.createElement('p');
  var link = document.createElement('a');
  var url = '';
  if (dep.issues){
    url = dep.issues.replace('/issues', '');
  } else {
    if (dep.releases){
      url = dep.releases[0].base;
    } else {
      alert(dep);
    }
  }
  link.href = url;
  link.appendChild(document.createTextNode(dep.name + '\t'));
  child.appendChild(link);

  if (url.lastIndexOf('https://github.com/', 0) === 0) {
    var gh_shield = document.createElement('img');
    gh_shield.src = 'https://img.shields.io/github/tag/' + url.substr(19) + '.svg';
    child.appendChild(gh_shield);
  }
  var pp_shield = document.createElement('img');
  pp_shield.src = 'https://img.shields.io/pypi/v/' + dep.name.replace('python-', '') + '.svg';
  child.appendChild(pp_shield);

  child.appendChild(document.createElement('br'));
  child.appendChild(document.createTextNode(dep.description));
  child.appendChild(document.createElement('br'));

  if (dep.releases[0].sublime_text) {
    if ('*' != dep.releases[0].sublime_text) {
      child.appendChild(document.createElement('br'));
      child.appendChild(document.createTextNode('ST version is restricted to ' + dep.releases[0].sublime_text));
    }
  }
  if (dep.releases[0].platforms) {
    if ('*' != dep.releases[0].platforms[0]) {
      child.appendChild(document.createElement('br'));
      child.appendChild(document.createTextNode('Platform restriction(s): ' + dep.releases[0].platforms));
    }
  }

  target.appendChild(child);
  target.appendChild(document.createElement('hr'));
}

var xmlhttp = getXmlHttp()
xmlhttp.open('GET', 'https://raw.githubusercontent.com/wbond/package_control_channel/master/repository/dependencies.json', true);
xmlhttp.onreadystatechange = function() {
  if (xmlhttp.readyState == 4) {
    if (xmlhttp.status == 200) {
      var json = JSON.parse(xmlhttp.responseText);
      var target = document.getElementById("deps")
      target.appendChild(document.createElement('hr'));
      var deps = json.dependencies;
      for (i = 0; i < deps.length; i++) {
        appendDep(deps[i], target);
      }
    } else {
      alert('GitHub did not respond! :(');
      return null
    }
  }
};

xmlhttp.send(null);
