export class Data {
  data = null;

  async get() {
    if (this.data) {
      return this.data;
    }

    try {
      let resource = '/packages/searchindex.json';
      const subdir = window.location.pathname;
      if (subdir && subdir !== '/') {
        resource = subdir + resource;
      }
      const response = await fetch(resource);
      const contentType = response.headers.get("content-type") ?? '';

      if (!response.ok || !contentType.includes('application/json')) {
        throw new Error('bad response');
      }

      this.data = response.json();
      return this.data;
    } catch (error) {
      console.error(error.message);
    }
  }
}
