export class Data {
	data = null;

	async get() {
	  if (this.data) {
	    return this.data;
	  }

	  try {
	    const response = await fetch('/packages/searchindex.json');
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
