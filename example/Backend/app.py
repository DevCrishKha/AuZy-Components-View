from flask import *

app = Flask(__name__)

@app.route('/', methods=['GET', 'POST'])    # index route is handling a POST request
def form():
#The User will first see form.html page and if a POST operation is made then the user will be directed to /greet route
    if request.method == 'POST':
        username = request.form['username']
        return redirect(url_for('greet', name=username))
    return render_template('form.html')

@app.route('/greet/<name>') # Route for a dynamic page
def greet(name):
    return f"Hello, {name}!" 


app.run(debug=True)

''' form.HTML: Body ==>
<body>
    <form action="/" method="post">
        <input type="text" id="username" name="username">
        <button type="submit">Submit</button>
    </form>
</body>
'''