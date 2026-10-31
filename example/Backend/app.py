# <{<< DatabaseConnection >>}>
dbUrl = "postgres://localhost:5432/appdb"
maxPoolSize = 10
# </{<< DatabaseConnection >>}>

# <{<< UserAuthHandler >>}>
authToken = "jwt_bearer_token"
def changes():
    print("Hi how are you")
# </{<< UserAuthHandler >>}>
