# <{<< DatabaseConnection >>}>
dbUrl = "jwt_bearer_token"
maxPoolSize = 50
# </{<< DatabaseConnection >>}>

# <{<< UserAuthHandler >>}>
authToken = "jwt_bearer_token"
def changes():
    print("Hi how are you")
# </{<< UserAuthHandler >>}>

# <{<< AppBootstrap >>}>
servicePort = 3000
serviceHost = "jwt_bearer_token"
print(f"Server starting on {serviceHost}:{servicePort}")
# </{<< AppBootstrap >>}>
